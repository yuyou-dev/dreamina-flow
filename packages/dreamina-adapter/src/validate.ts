import type { NodeDefinition, ResolvedInputValue, ValidationResult } from "@workflow-studio/workflow-core";
import { isProcessorNode } from "./catalog.js";

function firstText(values: ResolvedInputValue[] | undefined): string | null {
  if (!values || values.length === 0) {
    return null;
  }
  const textValues = values.filter((value): value is Extract<ResolvedInputValue, { kind: "text" }> => value.kind === "text");
  return textValues.map((value) => value.text.trim()).filter(Boolean).join("\n") || null;
}

function mediaPaths(values: ResolvedInputValue[] | undefined, expectedKind: "image" | "video" | "audio"): string[] {
  if (!values) {
    return [];
  }
  return values
    .filter((value): value is Extract<ResolvedInputValue, { kind: "image" | "video" | "audio" }> => value.kind === expectedKind)
    .map((value) => value.localPath);
}

function ensureRange(errors: string[], value: number | undefined, min: number, max: number, label: string): void {
  if (value === undefined || Number.isNaN(value)) {
    return;
  }
  if (value < min || value > max) {
    errors.push(`${label} must be between ${min} and ${max}.`);
  }
}

function validateImage2Video(normalized: Record<string, unknown>, errors: string[]): void {
  const modelVersion = normalized.model_version ? String(normalized.model_version) : "";
  const duration = normalized.duration !== undefined ? Number(normalized.duration) : undefined;
  const videoResolution = normalized.video_resolution ? String(normalized.video_resolution) : undefined;

  if ((duration !== undefined || videoResolution) && !modelVersion) {
    errors.push("image2video requires model_version when duration or video_resolution is set.");
    return;
  }
  if (!modelVersion) {
    return;
  }
  const rules: Record<string, { min: number; max: number; resolutions: string[] }> = {
    "3.0": { min: 3, max: 10, resolutions: ["720p", "1080p"] },
    "3.0fast": { min: 3, max: 10, resolutions: ["720p", "1080p"] },
    "3.0pro": { min: 3, max: 10, resolutions: ["1080p"] },
    "3.5pro": { min: 4, max: 12, resolutions: ["720p", "1080p"] },
    "seedance2.0": { min: 4, max: 15, resolutions: ["720p"] },
    "seedance2.0fast": { min: 4, max: 15, resolutions: ["720p"] },
    "seedance2.0_vip": { min: 4, max: 15, resolutions: ["720p"] },
    "seedance2.0fast_vip": { min: 4, max: 15, resolutions: ["720p"] },
  };
  const normalizedModel = ({ "3.0_fast": "3.0fast", "3.0_pro": "3.0pro", "3.5_pro": "3.5pro" } as Record<string, string>)[modelVersion] ?? modelVersion;
  const rule = rules[normalizedModel];
  if (!rule) {
    errors.push(`Unsupported image2video model_version: ${modelVersion}.`);
    return;
  }
  ensureRange(errors, duration, rule.min, rule.max, "image2video duration");
  if (videoResolution && !rule.resolutions.includes(videoResolution)) {
    errors.push(`image2video video_resolution must be one of: ${rule.resolutions.join(", ")}.`);
  }
}

function validateFrames2Video(normalized: Record<string, unknown>, errors: string[]): void {
  const modelVersion = String(normalized.model_version ?? "seedance2.0fast");
  const duration = normalized.duration !== undefined ? Number(normalized.duration) : undefined;
  const videoResolution = normalized.video_resolution ? String(normalized.video_resolution) : undefined;
  const rules: Record<string, { min: number; max: number; resolutions: string[] }> = {
    "3.0": { min: 3, max: 10, resolutions: ["720p", "1080p"] },
    "3.5pro": { min: 4, max: 12, resolutions: ["720p", "1080p"] },
    "seedance2.0": { min: 4, max: 15, resolutions: ["720p"] },
    "seedance2.0fast": { min: 4, max: 15, resolutions: ["720p"] },
    "seedance2.0_vip": { min: 4, max: 15, resolutions: ["720p"] },
    "seedance2.0fast_vip": { min: 4, max: 15, resolutions: ["720p"] },
  };
  const rule = rules[modelVersion];
  if (!rule) {
    errors.push(`Unsupported frames2video model_version: ${modelVersion}.`);
    return;
  }
  ensureRange(errors, duration, rule.min, rule.max, "frames2video duration");
  if (videoResolution && !rule.resolutions.includes(videoResolution)) {
    errors.push(`frames2video video_resolution must be one of: ${rule.resolutions.join(", ")}.`);
  }
}

function validateMultiframe2Video(normalized: Record<string, unknown>, errors: string[]): void {
  const images = (normalized.images as string[] | undefined) ?? [];
  const prompt = normalized.prompt ? String(normalized.prompt) : "";
  const duration = normalized.duration !== undefined ? Number(normalized.duration) : undefined;
  const transitionPrompt = ((normalized.transition_prompt as string[] | undefined) ?? []).filter(Boolean);
  const transitionDuration = ((normalized.transition_duration as number[] | undefined) ?? []).map(Number).filter((value) => !Number.isNaN(value));

  if (images.length < 2 || images.length > 20) {
    errors.push("multiframe2video requires between 2 and 20 images.");
    return;
  }
  if (images.length === 2) {
    if (!prompt) {
      errors.push("multiframe2video with exactly 2 images requires prompt.");
    }
    if (transitionPrompt.length > 0 || transitionDuration.length > 0) {
      errors.push("Use prompt and duration for 2-image multiframe2video. Do not send transition fields.");
    }
    if (duration !== undefined && (duration < 2 || duration > 8)) {
      errors.push("multiframe2video duration must be between 2 and 8 seconds for the 2-image mode.");
    }
    return;
  }
  if (prompt || duration !== undefined) {
    errors.push("multiframe2video with 3 or more images must use transition_prompt and transition_duration instead of prompt or duration.");
  }
  if (transitionPrompt.length !== images.length - 1) {
    errors.push(`multiframe2video with ${images.length} images requires ${images.length - 1} transition_prompt values.`);
  }
  if (transitionDuration.length > 0 && transitionDuration.length !== images.length - 1) {
    errors.push(`multiframe2video with ${images.length} images requires either 0 or ${images.length - 1} transition_duration values.`);
  }
  const effectiveDurations = transitionDuration.length > 0 ? transitionDuration : new Array(images.length - 1).fill(3);
  const total = effectiveDurations.reduce((sum, value) => sum + value, 0);
  if (effectiveDurations.some((value) => value < 0.5 || value > 8)) {
    errors.push("Each multiframe2video transition_duration must be between 0.5 and 8 seconds.");
  }
  if (total < 2) {
    errors.push("The total multiframe2video duration must be at least 2 seconds.");
  }
}

function validateMultimodal2Video(normalized: Record<string, unknown>, errors: string[]): void {
  const imagesRaw = normalized.image;
  const videosRaw = normalized.video;
  const audiosRaw = normalized.audio;
  const images = Array.isArray(imagesRaw) ? imagesRaw : (typeof imagesRaw === "string" && imagesRaw ? [imagesRaw] : []);
  const videos = Array.isArray(videosRaw) ? videosRaw : (typeof videosRaw === "string" && videosRaw ? [videosRaw] : []);
  const audios = Array.isArray(audiosRaw) ? audiosRaw : (typeof audiosRaw === "string" && audiosRaw ? [audiosRaw] : []);
  if (images.length === 0 && videos.length === 0) {
    errors.push("multimodal2video requires at least one image or video input.");
  }
  if (images.length > 9) {
    errors.push("multimodal2video supports at most 9 images.");
  }
  if (videos.length > 3) {
    errors.push("multimodal2video supports at most 3 videos.");
  }
  if (audios.length > 3) {
    errors.push("multimodal2video supports at most 3 audio files.");
  }
  ensureRange(errors, normalized.duration !== undefined ? Number(normalized.duration) : undefined, 4, 15, "multimodal2video duration");
}

function validateImage2Image(normalized: Record<string, unknown>, errors: string[]): void {
  const images = Array.isArray(normalized.images) ? normalized.images : [];
  if (images.length < 1 || images.length > 10) {
    errors.push("image2image requires between 1 and 10 images.");
  }
}

function validateText2Image(normalized: Record<string, unknown>, errors: string[]): void {
  const resolutionType = normalized.resolution_type ? String(normalized.resolution_type) : "";
  const modelVersion = normalized.model_version ? String(normalized.model_version) : "";
  if (resolutionType === "1k" && !["3.0", "3.1"].includes(modelVersion)) {
    errors.push("text2image resolution_type=1k requires model_version 3.0 or 3.1.");
  }
  if (resolutionType === "4k" && modelVersion && !["4.0", "4.1", "4.5", "4.6", "5.0"].includes(modelVersion)) {
    errors.push("text2image resolution_type=4k only supports 4.x or 5.0.");
  }
}

export function validateNodeRun(
  node: NodeDefinition,
  params: Record<string, unknown>,
  resolvedInputs: Record<string, ResolvedInputValue[]>,
): ValidationResult {
  const errors: string[] = [];
  const warnings = [...node.warnings];
  const normalizedParams: Record<string, unknown> = {};

  if (!isProcessorNode(node.name)) {
    return {
      ok: false,
      normalizedParams: {},
      errors: [`${node.name} is not a processor node.`],
      warnings,
    };
  }

  node.inputs.forEach((input) => {
    const inputRequired = Boolean(input.required);
    const values = resolvedInputs[input.id];
    if (!values || values.length === 0) {
      if (inputRequired) {
        errors.push(`Missing input: ${input.label}.`);
      }
      return;
    }
    if (input.type === "text") {
      const text = firstText(values);
      if (!text) {
        if (inputRequired) {
          errors.push(`Missing text input for ${input.label}.`);
        }
        return;
      }
      normalizedParams[input.id] = input.multiple ? text.split("\n").filter(Boolean) : text;
      return;
    }
    const paths = mediaPaths(values, input.type);
    if (paths.length === 0) {
      if (inputRequired) {
        errors.push(`Missing ${input.type} input for ${input.label}.`);
      }
      return;
    }
    normalizedParams[input.id] = input.multiple ? paths : paths[0];
  });

  node.params.forEach((parameter) => {
    const value = params[parameter.key];
    if (value === undefined || value === null || value === "") {
      return;
    }
    if (parameter.multiple) {
      if (Array.isArray(value)) {
        normalizedParams[parameter.key] = value;
      } else if (typeof value === "string") {
        normalizedParams[parameter.key] = value
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean);
      }
      return;
    }
    if (parameter.type === "number") {
      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        errors.push(`${parameter.label} must be a number.`);
        return;
      }
      normalizedParams[parameter.key] = parsed;
      return;
    }
    normalizedParams[parameter.key] = value;
  });

  switch (node.name) {
    case "text2image":
      validateText2Image(normalizedParams, errors);
      break;
    case "image2image":
      validateImage2Image(normalizedParams, errors);
      break;
    case "image2video":
      validateImage2Video(normalizedParams, errors);
      break;
    case "frames2video":
      validateFrames2Video(normalizedParams, errors);
      break;
    case "multiframe2video":
      validateMultiframe2Video(normalizedParams, errors);
      break;
    case "multimodal2video":
      validateMultimodal2Video(normalizedParams, errors);
      break;
    case "text2video":
      ensureRange(errors, normalizedParams.duration !== undefined ? Number(normalizedParams.duration) : undefined, 4, 15, "text2video duration");
      break;
    default:
      break;
  }

  return {
    ok: errors.length === 0,
    normalizedParams,
    errors,
    warnings,
  };
}
