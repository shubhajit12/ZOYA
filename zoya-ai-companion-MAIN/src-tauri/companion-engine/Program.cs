using System.Text.Json;

namespace ZOYA.CompanionEngine;

internal static class Program
{
    public static void Main()
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        Console.Error.WriteLine("[ZOYA Companion Engine] started");

        var engine = new WindowEngine();
        while (true)
        {
            var line = Console.ReadLine();
            if (line is null) break;
            if (string.IsNullOrWhiteSpace(line)) continue;

            try
            {
                using var document = JsonDocument.Parse(line);
                engine.Handle(document.RootElement);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[ZOYA Companion Engine] {ex.Message}");
                Console.WriteLine(JsonSerializer.Serialize(new { type = "error", message = ex.Message }));
                Console.Out.Flush();
            }
        }
    }
}
