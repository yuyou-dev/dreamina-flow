import { INPUT_NODE_DEFS, OUTPUT_NODE_DEFS, getDefaultPollSeconds } from "@workflow-studio/workflow-core";
import type { DataType, NodeCatalogResponse, NodeDefinition, NodeParamDefinition, NodePort } from "@workflow-studio/workflow-core";

type WrapperCapabilityParameter = {
  key: string;
  multiple: boolean;
  required: boolean;
  value_type: string;
  choices: string[];
  min_value: number | null;
  max_value: number | null;
  path_mode: "file" | "dir" | null;
};

type WrapperCapabilityCommand = {
  name: string;
  description: string;
  output_mode: string;
  parameters: WrapperCapabilityParameter[];
};

interface ProcessorNodeTemplate {
  title: string;
  inputs: NodePort[];
  outputs: NodePort[];
  defaults: Record<string, unknown>;
  warnings: string[];
  constraints: Record<string, unknown>;
}

const ratioChoices = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"];
const videoRatioChoices = ["1:1", "3:4", "16:9", "4:3", "9:16", "21:9"];

const processorTemplates: Record<string, ProcessorNodeTemplate> = {
  text2image: {
    title: "Text to Image",
    inputs: [{ id: "prompt", label: "Prompt", type: "text", required: true }],
    outputs: [{ id: "image", label: "Image", type: "image" }],
    defaults: { ratio: "16:9", resolution_type: "2k", model_version: "3.1", poll: getDefaultPollSeconds("text2image") },
    warnings: ["1k only works with model 3.0 or 3.1.", "4k is limited to 4.x or 5.0."],
    constraints: {
      supportedRatios: ratioChoices,
      resolutionRules: {
        "1k": ["3.0", "3.1"],
        "2k": ["3.0", "3.1", "4.0", "4.1", "4.5", "4.6", "5.0"],
        "4k": ["4.0", "4.1", "4.5", "4.6", "5.0"],
      },
    },
  },
  image2image: {
    title: "Image to Image",
    inputs: [
      { id: "images", label: "Images (1-10)", type: "image", multiple: true, required: true },
      { id: "prompt", label: "Prompt", type: "text", required: false },
    ],
    outputs: [{ id: "image", label: "Image", type: "image" }],
    defaults: { ratio: "16:9", resolution_type: "2k", model_version: "4.0", poll: getDefaultPollSeconds("image2image") },
    warnings: [],
    constraints: { supportedRatios: ratioChoices, imageRange: [1, 10] },
  },
  image_upscale: {
    title: "Image Upscale",
    inputs: [{ id: "image", label: "Image", type: "image", required: true }],
    outputs: [{ id: "image", label: "Image", type: "image" }],
    defaults: { resolution_type: "4k", poll: getDefaultPollSeconds("image_upscale") },
    warnings: ["4k and 8k upscale require VIP."],
    constraints: {},
  },
  text2video: {
    title: "Text to Video",
    inputs: [{ id: "prompt", label: "Prompt", type: "text", required: true }],
    outputs: [{ id: "video", label: "Video", type: "video" }],
    defaults: { duration: 5, ratio: "16:9", video_resolution: "720p", model_version: "seedance2.0fast", poll: getDefaultPollSeconds("text2video") },
    warnings: ["Some Seedance models may require one-time web authorization before use."],
    constraints: { supportedRatios: videoRatioChoices },
  },
  image2video: {
    title: "Image to Video",
    inputs: [
      { id: "image", label: "First Frame", type: "image", required: true },
      { id: "prompt", label: "Prompt", type: "text", required: true },
    ],
    outputs: [{ id: "video", label: "Video", type: "video" }],
    defaults: { duration: 5, video_resolution: "1080p", model_version: "3.0", poll: getDefaultPollSeconds("image2video") },
    warnings: ["Advanced duration and resolution controls require model_version.", "Ratio is inferred from the input image."],
    constraints: {
      modelRules: {
        "3.0": { duration: [3, 10], video_resolution: ["720p", "1080p"] },
        "3.0fast": { duration: [3, 10], video_resolution: ["720p", "1080p"] },
        "3.0pro": { duration: [3, 10], video_resolution: ["1080p"] },
        "3.5pro": { duration: [4, 12], video_resolution: ["720p", "1080p"] },
        "seedance2.0": { duration: [4, 15], video_resolution: ["720p"] },
        "seedance2.0fast": { duration: [4, 15], video_resolution: ["720p"] },
        "seedance2.0_vip": { duration: [4, 15], video_resolution: ["720p"] },
        "seedance2.0fast_vip": { duration: [4, 15], video_resolution: ["720p"] },
      },
      aliases: {
        "3.0_fast": "3.0fast",
        "3.0_pro": "3.0pro",
        "3.5_pro": "3.5pro",
      },
      inferredFields: ["ratio"],
      requiresModelForAdvancedControls: true,
    },
  },
  frames2video: {
    title: "Frames to Video",
    inputs: [
      { id: "first", label: "First Frame", type: "image", required: true },
      { id: "last", label: "Last Frame", type: "image", required: true },
      { id: "prompt", label: "Prompt", type: "text", required: true },
    ],
    outputs: [{ id: "video", label: "Video", type: "video" }],
    defaults: { duration: 5, video_resolution: "720p", model_version: "seedance2.0fast", poll: getDefaultPollSeconds("frames2video") },
    warnings: ["Ratio is inferred from the first frame image."],
    constraints: {
      modelRules: {
        "3.0": { duration: [3, 10], video_resolution: ["720p", "1080p"] },
        "3.5pro": { duration: [4, 12], video_resolution: ["720p", "1080p"] },
        "seedance2.0": { duration: [4, 15], video_resolution: ["720p"] },
        "seedance2.0fast": { duration: [4, 15], video_resolution: ["720p"] },
        "seedance2.0_vip": { duration: [4, 15], video_resolution: ["720p"] },
        "seedance2.0fast_vip": { duration: [4, 15], video_resolution: ["720p"] },
      },
      inferredFields: ["ratio"],
    },
  },
  multiframe2video: {
    title: "Multi-frame to Video",
    inputs: [
      { id: "images", label: "Images (2-20)", type: "image", multiple: true, required: true },
      { id: "prompt", label: "Prompt (2 imgs)", type: "text", required: false },
      { id: "transition_prompt", label: "Transition Prompts", type: "text", multiple: true, required: false },
    ],
    outputs: [{ id: "video", label: "Video", type: "video" }],
    defaults: { duration: 3, transition_duration: [], poll: getDefaultPollSeconds("multiframe2video") },
    warnings: [
      "Exactly 2 images use prompt and duration.",
      "3 or more images require transition_prompt values for every transition.",
    ],
    constraints: {
      imageRange: [2, 20],
      transitionDurationRange: [0.5, 8],
      minTotalDuration: 2,
    },
  },
  multimodal2video: {
    title: "Multimodal to Video",
    inputs: [
      { id: "image", label: "Images (0-9)", type: "image", multiple: true, required: false },
      { id: "video", label: "Videos (0-3)", type: "video", multiple: true, required: false },
      { id: "audio", label: "Audio (0-3)", type: "audio", multiple: true, required: false },
      { id: "prompt", label: "Prompt", type: "text", required: false },
    ],
    outputs: [{ id: "video", label: "Video", type: "video" }],
    defaults: { duration: 5, ratio: "16:9", video_resolution: "720p", model_version: "seedance2.0fast", poll: getDefaultPollSeconds("multimodal2video") },
    warnings: [
      "At least one image or video is required.",
      "Audio references must be between 2 and 15 seconds in Dreamina.",
    ],
    constraints: {
      supportedRatios: videoRatioChoices,
      maxInputs: { image: 9, video: 3, audio: 3 },
    },
  },
};

const parameterLabels: Record<string, string> = {
  prompt: "Prompt",
  ratio: "Ratio",
  resolution_type: "Resolution",
  model_version: "Model",
  poll: "Poll (s)",
  images: "Images",
  image: "Image",
  duration: "Duration (s)",
  video_resolution: "Resolution",
  first: "First Frame",
  last: "Last Frame",
  transition_prompt: "Transition Prompts",
  transition_duration: "Transition Duration",
  audio: "Audio",
  video: "Video",
  submit_id: "Submit ID",
  download_dir: "Download Dir",
  gen_status: "Generation Status"
};

function toParamType(parameter: WrapperCapabilityParameter): NodeParamDefinition["type"] {
  if (parameter.choices.length > 0) {
    return "select";
  }
  if (parameter.value_type === "int" || parameter.value_type === "float") {
    return "number";
  }
  if (parameter.value_type === "bool") {
    return "boolean";
  }
  return "string";
}

function toLabel(key: string): string {
  if (parameterLabels[key]) {
    return parameterLabels[key];
  }
  return key
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function unionModelRuleChoices(template: ProcessorNodeTemplate, key: "video_resolution"): string[] {
  if (!("modelRules" in template.constraints)) {
    return [];
  }
  const values = new Set<string>();
  Object.values(template.constraints.modelRules as Record<string, { video_resolution?: string[] }>).forEach((rule) => {
    (rule.video_resolution ?? []).forEach((choice) => values.add(choice));
  });
  const preferredOrder = ["720p", "1080p"];
  return preferredOrder.filter((choice) => values.has(choice));
}

export function isProcessorNode(nodeType: string): boolean {
  return Boolean(processorTemplates[nodeType]);
}

export function isInputNode(nodeType: string): boolean {
  return INPUT_NODE_DEFS.some((node) => node.name === nodeType);
}

export function isOutputNode(nodeType: string): boolean {
  return OUTPUT_NODE_DEFS.some((node) => node.name === nodeType);
}

export function outputKindForNode(nodeType: string): DataType | null {
  const found = [...INPUT_NODE_DEFS, ...OUTPUT_NODE_DEFS].find((node) => node.name === nodeType);
  return found?.outputs[0]?.type ?? found?.inputs[0]?.type ?? null;
}

export function buildProcessorDefinitions(wrapperCommands: WrapperCapabilityCommand[], rawHelpMap: Record<string, string>): NodeDefinition[] {
  return wrapperCommands
    .filter((command) => processorTemplates[command.name])
    .map((command) => {
      const template = processorTemplates[command.name];
      const inputKeys = new Set(template.inputs.map((input) => input.id));
      const params = command.parameters
        .filter((parameter) => !inputKeys.has(parameter.key))
        .map((parameter) => {
          let choices = parameter.choices;
          let pType = toParamType(parameter);
          if (choices.length === 0 && parameter.key === "model_version" && "modelRules" in template.constraints) {
            choices = Object.keys(template.constraints.modelRules as Record<string, unknown>);
            pType = "select";
          } else if (choices.length === 0 && parameter.key === "video_resolution") {
            const derivedChoices = unionModelRuleChoices(template, "video_resolution");
            if (derivedChoices.length > 0) {
              choices = derivedChoices;
              pType = "select";
            }
          }
          return {
            key: parameter.key,
            label: toLabel(parameter.key),
            type: pType,
            required: parameter.required,
            multiple: parameter.multiple,
            choices,
            min: parameter.min_value ?? undefined,
            max: parameter.max_value ?? undefined,
            default: template.defaults[parameter.key],
            pathMode: parameter.path_mode,
          } satisfies NodeParamDefinition;
        });
      return {
        name: command.name,
        title: template.title,
        category: "processor",
        description: command.description,
        inputs: template.inputs,
        outputs: template.outputs,
        params,
        defaults: template.defaults,
        outputMode: command.output_mode,
        wrapperAvailable: true,
        rawCliAvailable: true,
        constraints: template.constraints,
        warnings: template.warnings,
        rawHelp: rawHelpMap[command.name],
      } satisfies NodeDefinition;
    });
}

export function buildNodeCatalog(processorNodes: NodeDefinition[]): NodeCatalogResponse {
  return {
    nodes: [...INPUT_NODE_DEFS, ...processorNodes, ...OUTPUT_NODE_DEFS],
    canvasNodes: {
      input: INPUT_NODE_DEFS,
      processor: processorNodes,
      output: OUTPUT_NODE_DEFS,
    },
  };
}
