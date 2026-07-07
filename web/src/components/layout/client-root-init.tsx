"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import { fetchChannelModels } from "@/services/api/image";
import { createModelChannel, encodeChannelModel, filterModelsByCapability, useConfigStore, type ModelChannel } from "@/stores/use-config-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const handledConfigParams = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const setLocked = useConfigStore((state) => state.setLocked);

    useEffect(() => {
        if (handledConfigParams.current) return;
        handledConfigParams.current = true;

        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        const locked = searchParams.get("locked") === "1" || searchParams.get("locked") === "true";
        if (!baseUrl && !apiKey) return;

        if (locked) setLocked(true);

        // 读完立即从地址栏抹掉，避免密钥残留在 URL
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        searchParams.delete("locked");
        searchParams.delete("ticket");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);

        // 深度绑定 Moon API：自动拉取模型 + 按能力分类 + 填入，全程不弹窗、失败不报错
        void bindMoonApi(baseUrl || "", apiKey || "");

        async function bindMoonApi(url: string, key: string) {
            const channel: ModelChannel = createModelChannel({ id: "default", name: "Moon API", baseUrl: url, apiKey: key, apiFormat: "openai" });
            // 先把渠道配好（即使模型拉取失败，baseUrl/key 也已就位）
            if (url) updateConfig("baseUrl", url);
            if (key) updateConfig("apiKey", key);
            updateConfig("channels", [channel]);

            let models: string[] = [];
            try {
                models = await fetchChannelModels(channel);
            } catch {
                return; // 拉取失败：保持现状，不报错、不弹窗
            }
            if (!models.length) return;

            channel.models = models;
            const options = models.map((m) => encodeChannelModel(channel.id, m));
            updateConfig("channels", [channel]);
            updateConfig("models", options);

            const image = filterModelsByCapability(options, "image");
            const video = filterModelsByCapability(options, "video");
            const text = filterModelsByCapability(options, "text");
            const audio = filterModelsByCapability(options, "audio");
            updateConfig("imageModels", image);
            updateConfig("videoModels", video);
            updateConfig("textModels", text);
            updateConfig("audioModels", audio);

            // 仅在当前选择为空或已失效时才回填默认，避免覆盖用户已选模型
            const state = useConfigStore.getState().config;
            if (image.length && !image.includes(state.imageModel)) updateConfig("imageModel", image[0]);
            if (video.length && !video.includes(state.videoModel)) updateConfig("videoModel", video[0]);
            if (text.length && !text.includes(state.textModel)) updateConfig("textModel", text[0]);
            if (audio.length && !audio.includes(state.audioModel)) updateConfig("audioModel", audio[0]);
        }
    }, [updateConfig, setLocked]);

    return <>{children}</>;
}
