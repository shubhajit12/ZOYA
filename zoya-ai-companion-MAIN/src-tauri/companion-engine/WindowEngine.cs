using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace ZOYA.CompanionEngine;

internal sealed class WindowEngine
{
    private const uint GA_ROOT = 2;
    private const uint GA_ROOTOWNER = 3;
    private const int GWL_EXSTYLE = -20;
    private const long WS_EX_TOOLWINDOW = 0x00000080L;
    private const long WS_EX_NOACTIVATE = 0x08000000L;
    private const long WS_EX_TRANSPARENT = 0x00000020L;
    private const long WS_EX_LAYERED = 0x00080000L;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_NOZORDER = 0x0004;
    private const uint SWP_SHOWWINDOW = 0x0040;
    private const int SW_HIDE = 0;
    private const int SW_SHOWNOACTIVATE = 4;

    private readonly object sync = new();
    private nint companionHwnd;
    private nint boundHwnd;
    private int boundOffsetX;
    private CancellationTokenSource? trackingCts;
    private CancellationTokenSource? dragCts;
    private WindowInfo? lastDragTarget;

    public void Handle(JsonElement command)
    {
        var op = command.TryGetProperty("op", out var opValue) ? opValue.GetString() : null;
        switch (op)
        {
            case "target":
                companionHwnd = ReadHwnd(command, "companionHwnd");
                WriteTarget(FindTargetUnderCursor(companionHwnd));
                break;
            case "bind":
                Bind(ReadHwnd(command, "companionHwnd"), ReadHwnd(command, "hwnd"),
                    command.TryGetProperty("offsetX", out var offset) && offset.TryGetInt32(out var x) ? x : null);
                break;
            case "drag_start":
                StartDrag(ReadHwnd(command, "companionHwnd"));
                break;
            case "drag_finish":
                WriteDragResult(FinishDrag());
                break;
            case "clear":
                Clear();
                break;
        }
    }

    private void Bind(nint companion, nint hwnd, int? offsetX = null)
    {
        lock (sync)
        {
            trackingCts?.Cancel();
            companionHwnd = companion;
            boundHwnd = IsValidSurface(hwnd, companionHwnd) ? hwnd : 0;
            if (boundHwnd == 0) return;

            if (offsetX.HasValue)
            {
                boundOffsetX = offsetX.Value;
            }
            else if (GetCursorPos(out var cursor) && GetWindowRect(companion, out var rect))
            {
                boundOffsetX = cursor.X - rect.Left;
            }

            var localHwnd = boundHwnd;
            var localOffsetX = boundOffsetX;
            trackingCts = new CancellationTokenSource();
            _ = TrackAsync(localHwnd, companionHwnd, localOffsetX, trackingCts.Token);
        }
    }

    private void StartDrag(nint companion)
    {
        lock (sync)
        {
            dragCts?.Cancel();
            companionHwnd = companion;
            lastDragTarget = null;

            if (!GetCursorPos(out var cursor) || !GetWindowRect(companion, out var rect))
                return;

            var offsetX = cursor.X - rect.Left;
            var offsetY = cursor.Y - rect.Top;
            var cts = new CancellationTokenSource();
            dragCts = cts;
            _ = DragAsync(companion, offsetX, offsetY, cts.Token);
        }
    }

    private async Task DragAsync(nint companion, int offsetX, int offsetY, CancellationToken token)
    {
        while (!token.IsCancellationRequested && IsLeftButtonDown())
        {
            if (GetCursorPos(out var cursor) && GetWindowRect(companion, out var rect))
            {
                var x = cursor.X - offsetX;
                var y = cursor.Y - offsetY;
                _ = SetWindowPos(companion, 0, x, y, rect.Right - rect.Left, rect.Bottom - rect.Top,
                    SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW);
            }

            await Task.Delay(8, token).ConfigureAwait(false);
        }

        if (!token.IsCancellationRequested)
        {
            var target = FindTargetUnderCursor(companion);
            lock (sync)
            {
                lastDragTarget = target;
            }
        }
    }

    private DragResult FinishDrag()
    {
        lock (sync)
        {
            GetCursorPos(out var cursor);
            var target = lastDragTarget;

            if (target is null)
            {
                // React's pointerup can arrive before the native drag loop observes
                // release. Resolve the final target synchronously.
                target = FindTargetUnderCursor(companionHwnd);
            }

            if (target is not null && GetWindowRect(companionHwnd, out var companionRect))
            {
                // Preserve the exact horizontal point where the user released Zoya.
                // Tracking will keep this offset instead of recentering the companion.
                var offsetX = cursor.X - companionRect.Left;
                Bind(companionHwnd, target.Value.Hwnd, offsetX);
            }

            lastDragTarget = null;
            dragCts?.Cancel();
            dragCts = null;
            return new DragResult(target, cursor.X, cursor.Y);
        }
    }

    private void Clear()
    {
        lock (sync)
        {
            trackingCts?.Cancel();
            trackingCts = null;
            dragCts?.Cancel();
            dragCts = null;
            lastDragTarget = null;
            boundHwnd = 0;
            boundOffsetX = 0;
        }
    }

    private static async Task TrackAsync(nint targetHwnd, nint companion, int offsetX, CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            if (!TryGetSurface(targetHwnd, companion, out var target)) return;
            if (!GetWindowRect(companion, out var companionRect)) return;

            var companionWidth = companionRect.Right - companionRect.Left;
            var companionHeight = companionRect.Bottom - companionRect.Top;
            var targetWidth = target.Right - target.Left;
            var maxOffset = Math.Max(0, targetWidth - companionWidth);
            var clampedOffset = Math.Clamp(offsetX, 0, maxOffset);
            var x = target.Left + clampedOffset;
            var y = target.Top - companionHeight;

            _ = SetWindowPos(companion, 0, x, y, companionWidth, companionHeight, SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW);
            await Task.Delay(16, token).ConfigureAwait(false);
        }
    }

    private static bool IsLeftButtonDown() => (GetAsyncKeyState(0x01) & 0x8000) != 0;

    private static WindowInfo? FindTargetUnderCursor(nint companion)
    {
        if (!GetCursorPos(out var point)) return null;

        var hit = WindowFromPoint(point);
        if (hit == companion)
        {
            // The companion is intentionally always-on-top, so WindowFromPoint
            // normally sees ZOYA instead of the application below her. Temporarily
            // remove only the companion from the hit-test stack while resolving
            // the drop target; never hide the target application.
            ShowWindow(companion, SW_HIDE);
            hit = WindowFromPoint(point);
            ShowWindow(companion, SW_SHOWNOACTIVATE);
        }

        return TryGetSurface(hit, companion, out var target) ? target : null;
    }

    private static bool TryGetSurface(nint hwnd, nint companion, out WindowInfo target)
    {
        target = default;
        if (!IsValidSurface(hwnd, companion)) return false;

        var root = GetAncestor(hwnd, GA_ROOT);
        var ownerRoot = GetAncestor(hwnd, GA_ROOTOWNER);
        if (IsValidSurface(ownerRoot, companion)) root = ownerRoot;
        if (!IsValidSurface(root, companion)) return false;
        if (!GetWindowRect(root, out var rect)) return false;
        if (rect.Right <= rect.Left || rect.Bottom <= rect.Top) return false;

        target = new WindowInfo(root, rect.Left, rect.Top, rect.Right, rect.Bottom, GetClassName(root), GetWindowText(root));
        return true;
    }

    private static bool IsValidSurface(nint hwnd, nint companion)
    {
        if (hwnd == 0 || hwnd == companion || !IsWindow(hwnd) || !IsWindowVisible(hwnd) || IsIconic(hwnd)) return false;
        var root = GetAncestor(hwnd, GA_ROOT);
        if (root == 0 || root == companion || !IsWindow(root) || !IsWindowVisible(root) || IsIconic(root)) return false;
        if (root == GetShellWindow()) return false;

        var cls = GetClassName(root);
        if (cls is "Shell_TrayWnd" or "Shell_SecondaryTrayWnd" or "WorkerW" or "Progman" or "Windows.UI.Core.CoreWindow") return false;

        var ex = GetWindowLongPtr(root, GWL_EXSTYLE).ToInt64();
        if ((ex & WS_EX_NOACTIVATE) != 0 || (ex & WS_EX_TOOLWINDOW) != 0) return false;
        if ((ex & WS_EX_LAYERED) != 0 && (ex & WS_EX_TRANSPARENT) != 0) return false;

        return GetWindowRect(root, out var rect) && rect.Right - rect.Left >= 160 && rect.Bottom - rect.Top >= 120;
    }

    private static void WriteTarget(WindowInfo? target)
    {
        object? payload = target is null ? null : new
        {
            hwnd = target.Value.Hwnd.ToInt64(),
            left = target.Value.Left,
            top = target.Value.Top,
            right = target.Value.Right,
            bottom = target.Value.Bottom,
        };
        Write(new { type = "target", target = payload });
    }

    private static void WriteDragResult(DragResult result)
    {
        object? payload = result.Target is null ? null : new
        {
            hwnd = result.Target.Value.Hwnd.ToInt64(),
            left = result.Target.Value.Left,
            top = result.Target.Value.Top,
            right = result.Target.Value.Right,
            bottom = result.Target.Value.Bottom,
        };
        Write(new { type = "drag_result", target = payload, cursorX = result.CursorX, cursorY = result.CursorY });
    }

    private static nint ReadHwnd(JsonElement command, string property)
    {
        if (!command.TryGetProperty(property, out var value)) return 0;
        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt64(out var n) => new nint(n),
            JsonValueKind.String when long.TryParse(value.GetString(), out var n) => new nint(n),
            _ => 0
        };
    }

    private static string GetClassName(nint hwnd)
    {
        var buffer = new StringBuilder(256);
        var len = GetClassNameW(hwnd, buffer, buffer.Capacity);
        return len > 0 ? buffer.ToString() : string.Empty;
    }

    private static string GetWindowText(nint hwnd)
    {
        var buffer = new StringBuilder(512);
        _ = GetWindowTextW(hwnd, buffer, buffer.Capacity);
        return buffer.ToString();
    }

    private static void Write(object value)
    {
        Console.WriteLine(JsonSerializer.Serialize(value));
        Console.Out.Flush();
    }

    private readonly record struct WindowInfo(nint Hwnd, int Left, int Top, int Right, int Bottom, string ClassName, string Title);
    private readonly record struct DragResult(WindowInfo? Target, int CursorX, int CursorY);
    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT lpPoint);
    [DllImport("user32.dll")] private static extern nint WindowFromPoint(POINT point);
    [DllImport("user32.dll")] private static extern nint GetAncestor(nint hwnd, uint flags);
    [DllImport("user32.dll")] private static extern bool IsWindow(nint hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(nint hwnd);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint hwnd, out RECT rect);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassNameW(nint hwnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(nint hwnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] private static extern nint GetShellWindow();
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")] private static extern bool ShowWindow(nint hWnd, int nCmdShow);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern nint GetWindowLongPtrW(nint hWnd, int nIndex);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(nint hWnd, nint hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    private static nint GetWindowLongPtr(nint hwnd, int index) => GetWindowLongPtrW(hwnd, index);
}
