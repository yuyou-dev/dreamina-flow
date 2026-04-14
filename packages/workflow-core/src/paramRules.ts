import type { FlowNode, NodeDefinition, NodeParamDefinition } from "./types.js";

type ModelRule = {
  duration?: [number, number];
  video_resolution?: string[];
};

type ParamState = {
  choices?: string[];
  min?: number;
  max?: number;
};

type ParamCorrection = {
  key: string;
  from: unknown;
  to: unknown;
  reason: string;
};

export type ParamRuleResolution = {
  params: Record<string, unknown>;
  paramStates: Record<string, ParamState>;
  warning?: string;
  corrections: ParamCorrection[];
  effectiveModel?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asNumberRange(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "number" || typeof value[1] !== "number") {
    return undefined;
  }
  return [value[0], value[1]];
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "(empty)";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return String(value);
}

function readAliases(definition: NodeDefinition): Record<string, string> {
  const aliases = asRecord(definition.constraints).aliases;
  return Object.fromEntries(
    Object.entries(asRecord(aliases)).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function readResolutionRules(definition: NodeDefinition): Record<string, string[]> {
  const resolutionRules = asRecord(definition.constraints).resolutionRules;
  return Object.fromEntries(
    Object.entries(asRecord(resolutionRules)).map(([key, value]) => [key, asStringArray(value)]),
  );
}

function readModelRules(definition: NodeDefinition): Record<string, ModelRule> {
  const modelRules = asRecord(definition.constraints).modelRules;
  return Object.fromEntries(
    Object.entries(asRecord(modelRules)).map(([key, value]) => {
      const record = asRecord(value);
      return [
        key,
        {
          duration: asNumberRange(record.duration),
          video_resolution: asStringArray(record.video_resolution),
        } satisfies ModelRule,
      ];
    }),
  );
}

function allowsAdvancedControls(definition: NodeDefinition): boolean {
  return Boolean(asRecord(definition.constraints).requiresModelForAdvancedControls);
}

function orderedChoices(param: NodeParamDefinition | undefined, allowed: string[]): string[] {
  if (!param?.choices || param.choices.length === 0) {
    return allowed;
  }
  return param.choices.filter((choice) => allowed.includes(choice));
}

function firstAllowedChoice(definition: NodeDefinition, key: string, allowedChoices: string[]): string {
  if (allowedChoices.length === 0) {
    return "";
  }
  const param = definition.params.find((entry) => entry.key === key);
  const defaultValue = definition.defaults[key] ?? param?.default;
  if (typeof defaultValue === "string" && allowedChoices.includes(defaultValue)) {
    return defaultValue;
  }
  return allowedChoices[0];
}

function setCorrection(
  params: Record<string, unknown>,
  corrections: ParamCorrection[],
  key: string,
  nextValue: unknown,
  reason: string,
) {
  const previousValue = params[key];
  if (Object.is(previousValue, nextValue)) {
    return;
  }
  params[key] = nextValue;
  corrections.push({
    key,
    from: previousValue,
    to: nextValue,
    reason,
  });
}

function parseNumericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function resolveNodeParamRules(definition: NodeDefinition, rawParams: Record<string, unknown>): ParamRuleResolution {
  const params = { ...rawParams };
  const corrections: ParamCorrection[] = [];
  const paramStates = Object.fromEntries(
    definition.params.map((param) => [
      param.key,
      {
        choices: param.choices,
        min: param.min,
        max: param.max,
      } satisfies ParamState,
    ]),
  ) as Record<string, ParamState>;

  const aliases = readAliases(definition);
  const modelRules = readModelRules(definition);
  const resolutionRules = readResolutionRules(definition);
  let warning = definition.warnings[0];
  let effectiveModel: string | null = null;

  const modelValue = typeof params.model_version === "string" ? params.model_version : "";
  if (modelValue && aliases[modelValue]) {
    setCorrection(params, corrections, "model_version", aliases[modelValue], `canonicalized alias ${modelValue}`);
  }

  definition.params.forEach((param) => {
    const currentValue = params[param.key];
    if (param.type !== "select" || typeof currentValue !== "string" || !currentValue || !param.choices?.length) {
      return;
    }
    if (!param.choices.includes(currentValue)) {
      setCorrection(
        params,
        corrections,
        param.key,
        firstAllowedChoice(definition, param.key, param.choices),
        `${param.key} no longer supports ${currentValue}`,
      );
    }
  });

  if (definition.name === "text2image") {
    const resolutionParam = definition.params.find((param) => param.key === "resolution_type");
    const modelVersion = typeof params.model_version === "string" ? params.model_version : "";
    const supportedResolutions = orderedChoices(
      resolutionParam,
      resolutionParam?.choices?.filter((choice) => {
        if (!modelVersion) {
          return true;
        }
        return resolutionRules[choice]?.includes(modelVersion);
      }) ?? [],
    );

    paramStates.resolution_type = {
      ...paramStates.resolution_type,
      choices: supportedResolutions,
    };

    if (
      typeof params.resolution_type === "string"
      && params.resolution_type
      && supportedResolutions.length > 0
      && !supportedResolutions.includes(params.resolution_type)
    ) {
      setCorrection(
        params,
        corrections,
        "resolution_type",
        firstAllowedChoice(definition, "resolution_type", supportedResolutions),
        modelVersion
          ? `model ${modelVersion} supports ${supportedResolutions.join("/")}`
          : `supported resolutions are ${supportedResolutions.join("/")}`,
      );
    }
    if (
      (params.resolution_type === undefined || params.resolution_type === null || params.resolution_type === "")
      && supportedResolutions.length > 0
    ) {
      setCorrection(
        params,
        corrections,
        "resolution_type",
        firstAllowedChoice(definition, "resolution_type", supportedResolutions),
        modelVersion
          ? `model ${modelVersion} requires a supported resolution`
          : `supported resolutions are ${supportedResolutions.join("/")}`,
      );
    }

    warning = modelVersion
      ? `Model ${modelVersion} supports ${supportedResolutions.join(" / ")} resolutions.`
      : definition.warnings[0];

    return { params, paramStates, warning, corrections, effectiveModel: modelVersion || null };
  }

  if (definition.name !== "image2video" && definition.name !== "frames2video") {
    return { params, paramStates, warning, corrections, effectiveModel: null };
  }

  const modelParam = definition.params.find((param) => param.key === "model_version");
  const resolutionParam = definition.params.find((param) => param.key === "video_resolution");
  const modelVersion = typeof params.model_version === "string" ? params.model_version : "";

  if (definition.name === "frames2video") {
    effectiveModel = modelVersion || String(definition.defaults.model_version ?? "seedance2.0fast");
  } else {
    effectiveModel = modelVersion || null;
  }

  if (definition.name === "image2video" && allowsAdvancedControls(definition) && !effectiveModel) {
    if (params.duration !== undefined && params.duration !== "") {
      setCorrection(params, corrections, "duration", "", "advanced controls require model_version");
    }
    if (params.video_resolution !== undefined && params.video_resolution !== "") {
      setCorrection(params, corrections, "video_resolution", "", "advanced controls require model_version");
    }
    paramStates.video_resolution = {
      ...paramStates.video_resolution,
      choices: [],
    };
    warning = "Set model_version to enable advanced duration and resolution controls.";
    return { params, paramStates, warning, corrections, effectiveModel: null };
  }

  const appliedRule = effectiveModel ? modelRules[effectiveModel] : undefined;
  if (!appliedRule) {
    if (modelParam?.choices) {
      paramStates.model_version = {
        ...paramStates.model_version,
        choices: orderedChoices(modelParam, modelParam.choices),
      };
    }
    return { params, paramStates, warning, corrections, effectiveModel };
  }

  const allowedVideoResolutions = orderedChoices(resolutionParam, appliedRule.video_resolution ?? []);
  paramStates.video_resolution = {
    ...paramStates.video_resolution,
    choices: allowedVideoResolutions,
  };

  if (
    typeof params.video_resolution === "string"
    && params.video_resolution
    && allowedVideoResolutions.length > 0
    && !allowedVideoResolutions.includes(params.video_resolution)
  ) {
    setCorrection(
      params,
      corrections,
      "video_resolution",
      firstAllowedChoice(definition, "video_resolution", allowedVideoResolutions),
      `model ${effectiveModel} supports ${allowedVideoResolutions.join("/")}`,
    );
  }
  if (
    (params.video_resolution === undefined || params.video_resolution === null || params.video_resolution === "")
    && allowedVideoResolutions.length > 0
  ) {
    setCorrection(
      params,
      corrections,
      "video_resolution",
      firstAllowedChoice(definition, "video_resolution", allowedVideoResolutions),
      `model ${effectiveModel} requires a supported resolution`,
    );
  }

  if (appliedRule.duration) {
    const [min, max] = appliedRule.duration;
    paramStates.duration = {
      ...paramStates.duration,
      min,
      max,
    };
    const durationValue = parseNumericValue(params.duration);
    if (durationValue !== undefined) {
      const clampedDuration = Math.min(Math.max(durationValue, min), max);
      if (clampedDuration !== durationValue) {
        setCorrection(params, corrections, "duration", clampedDuration, `model ${effectiveModel} supports ${min}-${max}s`);
      }
    }
  }

  warning = `Model ${effectiveModel} supports ${allowedVideoResolutions.join(" / ")} and duration ${appliedRule.duration?.[0]}-${appliedRule.duration?.[1]}s.`;
  return { params, paramStates, warning, corrections, effectiveModel };
}

export function createCorrectedWorkflowWarning(nodeId: string, correction: ParamCorrection): string {
  return `Node ${nodeId}: corrected ${correction.key} from ${formatValue(correction.from)} to ${formatValue(correction.to)} (${correction.reason}).`;
}

export function normalizeNodeParams(definition: NodeDefinition, rawParams: Record<string, unknown>) {
  return resolveNodeParamRules(definition, rawParams).params;
}

export function normalizeNodesForDefinitions(
  nodes: FlowNode[],
  definitions: Record<string, NodeDefinition>,
): { nodes: FlowNode[]; warnings: string[]; changed: boolean } {
  let changed = false;
  const warnings: string[] = [];
  const nextNodes = nodes.map((node) => {
    const definition = definitions[node.data.nodeType];
    if (!definition || definition.category !== "processor") {
      return node;
    }
    const resolution = resolveNodeParamRules(definition, node.data.params);
    if (resolution.corrections.length === 0) {
      return node;
    }
    changed = true;
    resolution.corrections.forEach((correction) => warnings.push(createCorrectedWorkflowWarning(node.id, correction)));
    return {
      ...node,
      data: {
        ...node.data,
        params: resolution.params,
      },
    };
  });
  return { nodes: nextNodes, warnings, changed };
}
