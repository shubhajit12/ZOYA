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
    private const uint EVENT_SYSTEM_MINIMIZESTART = 0x0016;
    private const uint EVENT_SYSTEM_MINIMIZEEND = 0x0017;

    private readonly object sync = new();
    private nint companionHwnd;
    private nint boundHwnd;
    private CancellationTokenSource? trackingCts;

    public void Handle(JsonElement command)
    {
        var op = command.TryGetProperty("op", out var opValue) ? opValue.GetString() : null;
        switch (op)
        {
            case "target":
                companionHwnd = ReadHwnd(command, "companionHwnd");
                Write(new { type = "target", target = FindTargetUnderCursor(companionHwnd) });
                break;
            case "bind":
                Bind(ReadHwnd(command, "hwnd"));
                break;
            case "clear":
                Clear();
                break;
            case "taskbar":
                Write(new { type = "taskbar", taskbar = GetPrimaryTaskbar() });
                break;
            case "ping":
                Write(new { type = "pong" });
                break;
            default:
                Write(new { type = "error", message = $"Unknown operation: {op}" });
                break;
        }
    }

    private void Bind(nint hwnd)
    {
        lock (sync)
        {
            trackingCts?.Cancel();
            boundHwnd = IsValidSurface(hwnd, companionHwnd) ? hwnd : 0;
            if (boundHwnd == 0)
            {
                Write(new { type = "lost" });
                return;
            }

            var localHwnd = boundHwnd;
            trackingCts = new CancellationTokenSource();
            _ = TrackAsync(localHwnd, trackingCts.Token);
        }
        Write(new { type = "bound", hwnd = hwnd.ToInt64() });
    }

    private void Clear()
    {
        lock (sync)
        {
            trackingCts?.Cancel();
            trackingCts = null;
            boundHwnd = 0;
        }
        Write(new { type = "cleared" });
    }

    private async Task TrackAsync(nint hwnd, CancellationToken token)
    {
        (int x, int y)? last = null;
        while (!token.IsCancellationRequested)
        {
            if (!TryGetSurface(hwnd, companionHwnd, out var target))
            {
                lock (sync)
                {
                    if (boundHwnd == hwnd) boundHwnd = 0;
                }
                Write(new { type = "lost", hwnd = hwnd.ToInt64() });
                return;
            }

            var width = target.Right - target.Left;
            var x = target.Left + Math.Max(0, (width - 330) / 2);
            var y = target.Top - 390;
            if (last != (x, y))
            {
                Write(new { type = "position", hwnd = hwnd.ToInt64(), x, y, left = target.Left, top = target.Top, right = target.Right, bottom = target.Bottom });
                last = (x, y);
            }
            await Task.Delay(16, token).ConfigureAwait(false);
        }
    }

    private static WindowInfo? FindTargetUnderCursor(nint companion)
    {
        if (!GetCursorPos(out var point)) return null;
        var hit = WindowFromPoint(point);
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

    private static TaskbarInfo? GetPrimaryTaskbar()
    {
        var hwnd = FindWindow("Shell_TrayWnd", null);
        if (hwnd == 0 || !GetWindowRect(hwnd, out var rect)) return null;
        return new TaskbarInfo(rect.Left, rect.Top, rect.Right, rect.Bottom);
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
    private readonly record struct TaskbarInfo(int Left, int Top, int Right, int Bottom);

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
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern nint FindWindow(string? lpClassName, string? lpWindowName);
    [DllImport("user32.dll")] private static extern nint GetShellWindow();
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern nint GetWindowLongPtrW(nint hWnd, int nIndex);
    private static nint GetWindowLongPtr(nint hwnd, int index) => GetWindowLongPtrW(hwnd, index);
}
