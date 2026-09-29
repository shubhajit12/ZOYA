package com.zoya.client;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.client.Minecraft;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

final class BridgeClient {
    static final int PORT = 32123;
    private static final URI BASE = URI.create("http://127.0.0.1:" + PORT);
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(java.time.Duration.ofSeconds(2)).build();

    private BridgeClient() {}

    static CompletableFuture<String> get(String path) {
        HttpRequest request = HttpRequest.newBuilder(BASE.resolve(path)).timeout(java.time.Duration.ofSeconds(5)).GET().build();
        return HTTP.sendAsync(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
            .thenApply(response -> response.statusCode() + " " + response.body());
    }

    static CompletableFuture<String> post(String path, String json) {
        HttpRequest request = HttpRequest.newBuilder(BASE.resolve(path))
            .timeout(java.time.Duration.ofSeconds(10))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
            .build();
        return HTTP.sendAsync(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
            .thenApply(response -> response.statusCode() + " " + response.body());
    }

    static CompletableFuture<Boolean> isOnline() {
        return get("/health").thenApply(response -> response.startsWith("200 ")).exceptionally(error -> false);
    }

    static CompletableFuture<String> launch() {
        return isOnline().thenCompose(online -> {
            if (online) return CompletableFuture.completedFuture("Bridge is already running.");
            try {
                Path executable = findBridgeExecutable().orElseThrow(() -> new IOException("MinecraftBridge.exe was not found."));
                Process process = new ProcessBuilder(executable.toString())
                    .directory(executable.getParent().toFile())
                    .redirectErrorStream(true)
                    .start();
                Thread.startVirtualThread(() -> {
                    try { process.waitFor(); }
                    catch (InterruptedException error) { Thread.currentThread().interrupt(); }
                });
                return waitForHealth(8000).thenApply(ok ->
                    ok ? "Minecraft Bridge launched: " + executable
                       : "Bridge process started, but /health did not become ready within 8 seconds.");
            } catch (Exception error) {
                return CompletableFuture.completedFuture("Launch failed: " + message(error));
            }
        });
    }

    static CompletableFuture<String> stop() {
        return post("/shutdown", "{}").exceptionally(error -> "Stop request failed: " + message(error));
    }

    static CompletableFuture<String> restart() {
        return stop().thenCompose(ignored -> {
            try { Thread.sleep(500); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            return launch();
        });
    }

    static CompletableFuture<String> status() {
        return get("/status").exceptionally(error -> "Bridge offline: " + message(error));
    }

    static CompletableFuture<String> task() {
        return get("/task").exceptionally(error -> "Task status unavailable: " + message(error));
    }

    static CompletableFuture<String> capabilities() {
        return get("/capabilities").exceptionally(error -> "Capability list unavailable: " + message(error));
    }

    static CompletableFuture<String> runCapability(String mode, String args) {
        JsonObject body = new JsonObject();
        body.addProperty("mode", mode);
        body.addProperty("args", args == null ? "" : args);
        return post("/capability", body.toString());
    }

    static CompletableFuture<String> cancel() {
        return post("/cancel", "{}").exceptionally(error -> "Cancel failed: " + message(error));
    }

    static String compact(String raw) {
        if (raw == null || raw.isBlank()) return "No response.";
        String body = raw;
        int separator = raw.indexOf(' ');
        int status = separator > 0 ? parseStatus(raw.substring(0, separator)) : -1;
        if (separator > 0) body = raw.substring(separator + 1).trim();
        try {
            var json = JsonParser.parseString(body);
            if (json.isJsonObject()) {
                JsonObject object = json.getAsJsonObject();
                if (object.has("error") && !object.get("error").isJsonNull())
                    return "HTTP " + status + " | ERROR: " + object.get("error").getAsString();
                if (object.has("message")) return "HTTP " + status + " | " + object.get("message").getAsString();
                if (object.has("ok") && object.has("status"))
                    return "HTTP " + status + " | ok=" + object.get("ok").getAsBoolean() + " | status=" + object.get("status").getAsString();
            }
        } catch (Exception ignored) {}
        return raw.length() > 900 ? raw.substring(0, 900) + "..." : raw;
    }

    static List<String> capabilityNames(String raw) {
        List<String> result = new ArrayList<>();
        try {
            int separator = raw.indexOf(' ');
            String body = separator > 0 ? raw.substring(separator + 1) : raw;
            var json = JsonParser.parseString(body);
            JsonArray capabilities = json.getAsJsonObject().getAsJsonArray("capabilities");
            if (capabilities != null) {
                capabilities.forEach(element -> {
                    if (element.isJsonObject()) {
                        JsonObject object = element.getAsJsonObject();
                        String id = object.has("id") ? object.get("id").getAsString() : null;
                        String usage = object.has("usage") ? object.get("usage").getAsString() : null;
                        if (id != null) result.add(id + (usage == null ? "" : " — " + usage));
                    }
                });
            }
        } catch (Exception ignored) {}
        return result;
    }

    private static CompletableFuture<Boolean> waitForHealth(long timeoutMs) {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
        CompletableFuture<Boolean> result = new CompletableFuture<>();
        Thread.startVirtualThread(() -> {
            while (System.nanoTime() < deadline) {
                try {
                    if (isOnline().get(750, TimeUnit.MILLISECONDS)) { result.complete(true); return; }
                } catch (Exception ignored) {}
                try { Thread.sleep(250); }
                catch (InterruptedException error) { Thread.currentThread().interrupt(); break; }
            }
            result.complete(false);
        });
        return result;
    }

    private static Optional<Path> findBridgeExecutable() {
        List<Path> candidates = new ArrayList<>();
        String configured = System.getenv("ZOYA_MINECRAFT_BRIDGE_EXE");
        if (configured != null && !configured.isBlank()) candidates.add(Path.of(configured));
        String property = System.getProperty("zoya.minecraft.bridge");
        if (property != null && !property.isBlank()) candidates.add(Path.of(property));

        Path gameDir = Minecraft.getInstance().gameDirectory.toPath();
        candidates.add(gameDir.resolve("MinecraftBridge.exe"));
        candidates.add(gameDir.resolve("minecraft-bridge").resolve("MinecraftBridge.exe"));
        candidates.add(gameDir.resolve("zoya-minecraft-bridge").resolve("MinecraftBridge.exe"));

        String appData = System.getenv("APPDATA");
        if (appData != null && !appData.isBlank()) {
            Path app = Path.of(appData);
            candidates.add(app.resolve("com.zoya.aicompanion/minecraft/MinecraftBridge.exe"));
            candidates.add(app.resolve("com.zoya.aicompanion/minecraft-bridge/MinecraftBridge.exe"));
            candidates.add(app.resolve("com.zoya.aicompanion/minecraft/bridge/MinecraftBridge.exe"));
        }

        return candidates.stream().map(Path::toAbsolutePath).filter(Files::isRegularFile)
            .filter(path -> path.getFileName().toString().equalsIgnoreCase("MinecraftBridge.exe")).findFirst();
    }

    private static int parseStatus(String value) {
        try { return Integer.parseInt(value); } catch (Exception ignored) { return -1; }
    }

    private static String message(Throwable error) {
        Throwable current = error;
        while (current.getCause() != null) current = current.getCause();
        return String.valueOf(current.getMessage() == null ? current : current.getMessage());
    }
}
