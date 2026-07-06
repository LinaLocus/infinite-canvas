"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { fetchChannelModels } from "@/services/api/image";
import {
    createModelChannel,
    encodeChannelModel,
    filterModelsByCapability,
    useConfigStore,
    type ModelChannel,
} from "@/stores/use-config-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const setLocked = useConfigStore((state) => state.setLocked);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        const locked = searchParams.get("locked") === "1" || searchParams.get("locked") === "true";
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        if (locked) setLocked(true);
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        searchParams.delete("locked");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);

        // locked 模式（从 Moon API 跳转）：全自动配置，拉取模型 + 按能力分类 + 填入，不弹窗
        if (locked && baseUrl && apiKey) {
            void autoConfigureFromMoonApi(baseUrl, apiKey);
            return;
        }

        // 非锁定模式：保留原有的“导入本地直连配置”行为
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(baseUrl ? { baseUrl } : {}),
                                ...(apiKey ? { apiKey } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: "默认渠道", baseUrl: baseUrl || undefined, apiKey: apiKey || "" })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
        message.success("已导入本地直连配置");

        async function autoConfigureFromMoonApi(url: string, key: string) {
            const channel: ModelChannel = createModelChannel({
                id: "default",
                name: "Moon API",
                baseUrl: url,
                apiKey: key,
                apiFormat: "openai",
            });

            let models: string[] = [];
            try {
                models = await fetchChannelModels(channel);
            } catch {
                // 拉取失败：至少把渠道配好，用户仍可手动拉取
                updateConfig("baseUrl", url);
                updateConfig("apiKey", key);
                updateConfig("channels", [channel]);
                message.warning("已连接 Moon API，但自动获取模型失败，请稍后重试");
                return;
            }

            channel.models = models;
            const modelOptions = models.map((m) => encodeChannelModel(channel.id, m));

            const imageModels = filterModelsByCapability(modelOptions, "image");
            const videoModels = filterModelsByCapability(modelOptions, "video");
            const textModels = filterModelsByCapability(modelOptions, "text");
            const audioModels = filterModelsByCapability(modelOptions, "audio");

            updateConfig("baseUrl", url);
            updateConfig("apiKey", key);
            updateConfig("channels", [channel]);
            updateConfig("models", modelOptions);
            updateConfig("imageModels", imageModels);
            updateConfig("videoModels", videoModels);
            updateConfig("textModels", textModels);
            updateConfig("audioModels", audioModels);
            if (imageModels[0]) updateConfig("imageModel", imageModels[0]);
            if (videoModels[0]) updateConfig("videoModel", videoModels[0]);
            if (textModels[0]) updateConfig("textModel", textModels[0]);
            if (audioModels[0]) updateConfig("audioModel", audioModels[0]);

            message.success(`已自动配置 Moon API（${models.length} 个模型）`);
        }
    }, [config.channels, message, openConfigDialog, updateConfig, setLocked]);

    return <>{children}</>;
}
