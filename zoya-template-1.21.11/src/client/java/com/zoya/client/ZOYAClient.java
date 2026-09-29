package com.zoya.client;

import com.mojang.brigadier.arguments.StringArgumentType;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandManager;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;

public class ZOYAClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        ClientCommandRegistrationCallback.EVENT.register((dispatcher, buildContext) -> {
            dispatcher.register(ClientCommandManager.literal("zoya")
                .then(ClientCommandManager.literal("help").executes(context -> {
                    reply(context, "/zoya launch | stop | restart | status | task | cancel | modes list | modes <mode> <arguments...>");
                    return 1;
                }))
                .then(ClientCommandManager.literal("launch").executes(context -> {
                    reply(context, "Launching Minecraft Bridge...");
                    BridgeClient.launch().thenAccept(response -> replyOnClient("§a[ZOYA] §f" + response));
                    return 1;
                }))
                .then(ClientCommandManager.literal("stop").executes(context -> {
                    reply(context, "Stopping Minecraft Bridge...");
                    BridgeClient.stop().thenAccept(response -> replyOnClient("§e[ZOYA] §f" + BridgeClient.compact(response)));
                    return 1;
                }))
                .then(ClientCommandManager.literal("restart").executes(context -> {
                    reply(context, "Restarting Minecraft Bridge...");
                    BridgeClient.restart().thenAccept(response -> replyOnClient("§a[ZOYA] §f" + response));
                    return 1;
                }))
                .then(ClientCommandManager.literal("status").executes(context -> {
                    reply(context, "Checking Bridge status...");
                    BridgeClient.status().thenAccept(response -> replyOnClient("§b[ZOYA] §f" + BridgeClient.compact(response)));
                    return 1;
                }))
                .then(ClientCommandManager.literal("task").executes(context -> {
                    BridgeClient.task().thenAccept(response -> replyOnClient("§b[ZOYA] §f" + BridgeClient.compact(response)));
                    return 1;
                }))
                .then(ClientCommandManager.literal("cancel").executes(context -> {
                    BridgeClient.cancel().thenAccept(response -> replyOnClient("§e[ZOYA] §f" + BridgeClient.compact(response)));
                    return 1;
                }))
                .then(ClientCommandManager.literal("modes")
                    .then(ClientCommandManager.literal("list").executes(context -> {
                        BridgeClient.capabilities().thenAccept(response -> {
                            var names = BridgeClient.capabilityNames(response);
                            if (names.isEmpty()) {
                                replyOnClient("§c[ZOYA] §f" + BridgeClient.compact(response));
                                return;
                            }
                            replyOnClient("§b[ZOYA] §fRegistered capabilities: " + names.size());
                            for (int i = 0; i < names.size(); i++) replyOnClient("§7" + (i + 1) + ". §f" + names.get(i));
                        });
                        return 1;
                    }))
                    .then(ClientCommandManager.argument("mode", StringArgumentType.word())
                        .then(ClientCommandManager.argument("arguments", StringArgumentType.greedyString()).executes(context -> {
                            String mode = StringArgumentType.getString(context, "mode").toLowerCase();
                            String args = StringArgumentType.getString(context, "arguments");
                            reply(context, "Running capability: " + mode + (args.isBlank() ? "" : " " + args));
                            BridgeClient.runCapability(mode, args).thenAccept(response ->
                                replyOnClient("§b[ZOYA] §f" + BridgeClient.compact(response)));
                            return 1;
                        }))
                        .executes(context -> {
                            String mode = StringArgumentType.getString(context, "mode").toLowerCase();
                            BridgeClient.runCapability(mode, "").thenAccept(response ->
                                replyOnClient("§b[ZOYA] §f" + BridgeClient.compact(response)));
                            return 1;
                        })))
            );
        });
    }

    private static void reply(com.mojang.brigadier.context.CommandContext<?> context, String message) {
        context.getSource().sendFeedback(Component.literal("§d[ZOYA] §f" + message));
    }

    private static void replyOnClient(String message) {
        Minecraft.getInstance().execute(() -> {
            if (Minecraft.getInstance().player != null)
                Minecraft.getInstance().player.displayClientMessage(Component.literal(message), false);
        });
    }
}
