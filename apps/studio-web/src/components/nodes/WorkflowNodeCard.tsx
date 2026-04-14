import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Handle, Position } from "@xyflow/react";
import { Film, Image as ImageIcon, Mic, Play, RefreshCw, Settings, Type, Upload, X } from "lucide-react";
import { DATA_TYPE_COLORS, STATUS_COLORS } from "../../config/workflowNodes";
import { useWorkflowStudioContext } from "../../context/WorkflowStudioContext";
import { resolveNodeParamRules } from "../../lib/paramRules";
import type { Artifact, NodeDefinition, NodeParamDefinition, WorkflowAssetRef, WorkflowCanvasNodeData } from "../../types";

const iconMap = {
  image: ImageIcon,
  video: Film,
  audio: Mic,
  text: Type,
};

function fieldValue(param: NodeParamDefinition, value: unknown): string {
  if (param.multiple && Array.isArray(value)) {
    return value.join("\n");
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return value === undefined || value === null ? "" : String(value);
}

function normalizeEditorValue(param: NodeParamDefinition, value: string): unknown {
  if (param.multiple) {
    const items = value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    if (param.type === "number") {
      return items.map((item) => Number(item)).filter((item) => !Number.isNaN(item));
    }
    return items;
  }
  if (param.type === "number") {
    return value === "" ? "" : Number(value);
  }
  return value;
}

function headerClass(definition: NodeDefinition): string {
  if (definition.category === "processor") {
    return "bg-[#1fe0f2] text-black";
  }
  if (definition.name.includes("text")) {
    return "bg-[#dcff39] text-black";
  }
  if (definition.name.includes("image")) {
    return "bg-[#ef8ae8] text-black";
  }
  if (definition.name.includes("video")) {
    return "bg-[#1fe0f2] text-black";
  }
  return "bg-[#ff922f] text-black";
}

type NodePreview =
  | { kind: "text"; text: string }
  | { kind: "image" | "video" | "audio"; artifact: Artifact }
  | { kind: "assetRef"; assetRef: WorkflowAssetRef };

function VideoSurface({
  artifact,
  onOpen,
  compact = false,
}: {
  artifact: Artifact;
  onOpen?: (artifact: Artifact) => void;
  compact?: boolean;
}) {
  const containerClassName = compact ? "relative h-full w-full overflow-hidden" : "relative w-full h-[104px] overflow-hidden rounded-md border-[1.5px] border-black bg-black";
  const body = (
    <div className={containerClassName}>
      <video
        src={artifact.previewUrl}
        className="h-full w-full object-cover opacity-95"
        muted
        playsInline
        preload="metadata"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
      <div className={`pointer-events-none absolute ${compact ? "bottom-1.5 right-1.5 h-6 w-6" : "bottom-2 right-2 h-8 w-8"} flex items-center justify-center rounded-full border-[1.5px] border-black bg-white/95 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]`}>
        <Play size={compact ? 10 : 12} fill="currentColor" className="translate-x-[1px]" />
      </div>
    </div>
  );

  if (!onOpen) {
    return body;
  }

  return (
    <button type="button" onClick={() => onOpen(artifact)} className="block w-full text-left" title={`Preview ${artifact.filename}`}>
      {body}
    </button>
  );
}

function VideoLightbox({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-5" onClick={onClose}>
      <div className="w-full max-w-4xl overflow-hidden rounded-[24px] border-[3px] border-black bg-[#fbfbf8] shadow-[4px_5px_0px_0px_rgba(0,0,0,1)]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b-[3px] border-black px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Video Preview</div>
            <div className="truncate text-sm font-black">{artifact.filename}</div>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl border-[2px] border-black bg-white">
            <X size={16} strokeWidth={3} />
          </button>
        </div>
        <div className="bg-black p-4">
          <video src={artifact.previewUrl} className="max-h-[72vh] w-full rounded-xl border-[2px] border-black bg-black" controls autoPlay playsInline />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function previewForOutput(nodeId: string, data: WorkflowCanvasNodeData, definition: NodeDefinition, context: ReturnType<typeof useWorkflowStudioContext>): NodePreview | null {
  if (definition.category === "input") {
    if (definition.name === "input_text") {
      return { kind: "text" as const, text: String(data.values.text ?? "") };
    }
    const asset = data.values.asset as Artifact | undefined;
    if (asset && (asset.kind === "image" || asset.kind === "video" || asset.kind === "audio")) {
      return { kind: asset.kind, artifact: asset };
    }
    const assetRef = data.values.assetRef as WorkflowAssetRef | undefined;
    return assetRef ? { kind: "assetRef", assetRef } : null;
  }

  if (definition.category === "processor") {
    const selectedId = data.values.selectedArtifactId as string | undefined;
    const artifact = data.execution.artifacts?.find((item) => item.assetId === selectedId) || data.execution.artifacts?.[0];
    return artifact && (artifact.kind === "image" || artifact.kind === "video" || artifact.kind === "audio")
      ? { kind: artifact.kind, artifact }
      : null;
  }

  const input = definition.inputs[0];
  const edge = context.edges.find((entry) => entry.target === nodeId && entry.targetHandle === input?.id);
  if (!edge) {
    return null;
  }
  const sourceNode = context.nodes.find((node) => node.id === edge.source);
  if (!sourceNode) {
    return null;
  }
  if (sourceNode.data.nodeType === "input_text") {
    return { kind: "text" as const, text: String(sourceNode.data.values.text ?? "") };
  }
  const selectedId = sourceNode.data.values.selectedArtifactId as string | undefined;
  const matchingArtifacts = (sourceNode.data.execution.artifacts ?? []).filter((entry) => entry.kind === input?.type);
  const artifact = (selectedId ? matchingArtifacts.find((entry) => entry.assetId === selectedId) : undefined)
    ?? matchingArtifacts[0]
    ?? (sourceNode.data.values.asset as Artifact | undefined);
  return artifact && (artifact.kind === "image" || artifact.kind === "video" || artifact.kind === "audio")
    ? { kind: artifact.kind, artifact }
    : null;
}

function renderMedia(preview: NodePreview | null, options: { onOpenVideo?: (artifact: Artifact) => void } = {}) {
  if (!preview) {
    return (
      <div className="w-full h-[104px] border-[1.5px] border-black rounded-md bg-white flex items-center justify-center text-gray-400 text-[10px] font-bold uppercase">
        No Media
      </div>
    );
  }
  if (preview.kind === "text") {
    return (
      <div className="w-full h-[104px] overflow-auto border-[1.5px] border-black rounded-md bg-white p-3 text-[10px] font-medium whitespace-pre-wrap">
        {preview.text || "No Text"}
      </div>
    );
  }
  if (preview.kind === "image") {
    return <img src={preview.artifact.previewUrl} alt={preview.artifact.filename} className="w-full h-[104px] object-cover border-[1.5px] border-black rounded-md" />;
  }
  if (preview.kind === "video") {
    return <VideoSurface artifact={preview.artifact} onOpen={options.onOpenVideo} />;
  }
  if (preview.kind === "assetRef") {
    return (
      <div className="w-full h-[104px] border-[1.5px] border-black rounded-md bg-[#fff8e1] p-3 flex flex-col justify-between">
        <div className="text-[9px] font-black uppercase tracking-[0.16em] text-[#8a5a00]">Media Reference</div>
        <div className="text-[10px] font-bold leading-4 text-[#8a5a00]">
          {preview.assetRef.name}
          <br />
          Re-upload this file before running the workflow.
        </div>
      </div>
    );
  }
  return <audio src={preview.artifact.previewUrl} className="w-full h-[104px] border-[1.5px] border-black rounded-md bg-white" controls />;
}

export function WorkflowNodeCard({ id, data }: { id: string; data: WorkflowCanvasNodeData }) {
  const context = useWorkflowStudioContext();
  const definition = context.definitions[data.nodeType];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const [lightboxArtifact, setLightboxArtifact] = useState<Artifact | null>(null);

  useEffect(() => {
    if (data.execution?.status !== "querying") {
      return;
    }
    refreshTimerRef.current = window.setTimeout(() => {
      void context.refreshNodeResult(id);
    }, 5000);
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [context, data.execution?.health?.lastUpdatedAt, data.execution?.status, id]);

  if (!definition) {
    return null;
  }

  const execution = data.execution ?? { status: "idle", artifacts: [] };
  const paramRuleView = useMemo(() => resolveNodeParamRules(definition, data.params), [data.params, definition]);
  const preview = previewForOutput(id, data, definition, context);
  const HeaderIcon =
    definition.category === "processor"
      ? Settings
      : iconMap[(definition.name.replace("input_", "").replace("output_", "") as keyof typeof iconMap) || "text"];
  const activeWarning = paramRuleView.warning ?? definition.warnings[0];
  const openVideoPreview = (artifact: Artifact) => setLightboxArtifact(artifact);
  const logTitle = execution.health?.logFile
    ? context.runtimeStatus?.logDirectory
      ? `${context.runtimeStatus.logDirectory}/${execution.health.logFile}`
      : execution.health.logFile
    : undefined;
  const isNodeLocked = execution.status === "validating" || execution.status === "running" || execution.status === "querying";
  const busyBorderColor = execution.status === "validating"
    ? "#ffb100"
    : execution.status === "running"
      ? "#1fe0f2"
      : execution.status === "querying"
        ? "#0ea5e9"
        : "#1fe0f2";

  return (
    <>
      <div
        className={`workflow-node-shell w-[260px] min-h-[316px] bg-[#fbfbf8] border-[2.5px] border-black rounded-[18px] shadow-[2px_3px_0px_0px_rgba(0,0,0,1)] flex flex-col overflow-visible ${isNodeLocked ? "workflow-node-shell--busy" : ""}`}
        style={isNodeLocked ? ({ "--workflow-node-breathe-color": busyBorderColor } as CSSProperties) : undefined}
      >
        <div className={`px-3 py-2 border-b-[2.5px] border-black flex justify-between items-center rounded-t-[15px] ${headerClass(definition)}`}>
          <div className="flex items-center gap-2">
            <HeaderIcon size={14} strokeWidth={2.5} />
            <span className="font-black text-[10px] uppercase tracking-[0.16em]">{data.label ?? definition.title}</span>
          </div>
          <button
            type="button"
            disabled={isNodeLocked}
            onClick={() => context.deleteNode(id)}
            className="leading-none transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
          >
            <X size={14} strokeWidth={3} />
          </button>
        </div>

        <div className="p-3 flex min-h-[270px] flex-col gap-2.5 relative justify-between">
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[8px] font-black border-[1.5px] border-black px-2 py-0.5 rounded-full uppercase tracking-[0.18em] bg-white ${STATUS_COLORS[execution.status]}`}>
                {execution.status}
              </span>
              {execution.submitId ? <span className="text-[8px] font-bold uppercase tracking-[0.16em] text-gray-500">run:{execution.submitId.slice(0, 8)}</span> : null}
            </div>

            {data.note ? <div className="text-[9px] font-bold leading-4 text-gray-500">{data.note}</div> : null}

            {definition.inputs.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <div className="text-[8px] font-black text-black uppercase tracking-[0.18em]">Inputs</div>
                {definition.inputs.map((input) => (
                  <div key={input.id} className="relative flex items-center border-[1.5px] border-black rounded-md bg-white px-2.5 py-1.5">
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={input.id}
                      className="!w-3 !h-3 !bg-white !border-[1.5px] !border-black !-left-[8px]"
                    />
                    <span className="text-[10px] font-bold uppercase tracking-[0.06em]">
                      {input.label}
                      {input.multiple ? " *" : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {definition.params.length > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                {definition.params.map((param) => {
                  const currentValue = paramRuleView.params[param.key];
                  const paramState = paramRuleView.paramStates[param.key] ?? {};
                  const availableChoices = paramState.choices ?? param.choices;
                  const shouldShowEmptyChoice = param.type === "select" && (((availableChoices?.length ?? 0) === 0) || currentValue === "");
                  return (
                    <div key={param.key} className="flex flex-col gap-1">
                      <label className="text-[8px] font-black text-black uppercase tracking-[0.16em]">{param.label}</label>
                      {param.type === "select" ? (
                        <select
                          value={fieldValue(param, currentValue)}
                          disabled={isNodeLocked}
                          onChange={(event) => context.updateNodeParams(id, param.key, event.target.value)}
                          className="w-full text-[10px] p-1.5 border-[1.5px] border-black rounded-md bg-white font-bold outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                        >
                          {shouldShowEmptyChoice ? <option value="">--</option> : null}
                          {availableChoices?.map((choice) => (
                            <option key={choice} value={choice}>
                              {choice}
                            </option>
                          ))}
                        </select>
                      ) : param.type === "boolean" ? (
                        <label className="flex items-center gap-2 border-[1.5px] border-black rounded-md px-2 py-1.5 text-[10px] font-bold">
                          <input
                            type="checkbox"
                            checked={Boolean(currentValue)}
                            disabled={isNodeLocked}
                            onChange={(event) => context.updateNodeParams(id, param.key, event.target.checked)}
                          />
                          Enabled
                        </label>
                      ) : param.multiple ? (
                        <textarea
                          value={fieldValue(param, currentValue)}
                          disabled={isNodeLocked}
                          onChange={(event) => context.updateNodeParams(id, param.key, normalizeEditorValue(param, event.target.value))}
                          className="w-full min-h-20 text-[10px] p-1.5 border-[1.5px] border-black rounded-md bg-white font-medium outline-none resize-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                          placeholder="One item per line"
                        />
                      ) : (
                        <input
                          type={param.type === "number" ? "number" : "text"}
                          value={fieldValue(param, currentValue)}
                          min={paramState.min ?? param.min}
                          max={paramState.max ?? param.max}
                          disabled={isNodeLocked}
                          onChange={(event) => context.updateNodeParams(id, param.key, normalizeEditorValue(param, event.target.value))}
                          className="w-full text-[10px] p-1.5 border-[1.5px] border-black rounded-md bg-white font-bold outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {definition.outputs.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <div className="text-[8px] font-black text-black uppercase tracking-[0.18em]">Outputs</div>
                {definition.outputs.map((output) => (
                  <div key={output.id} className="relative flex items-center justify-end border-[1.5px] border-black rounded-md px-3 py-1.5" style={{ backgroundColor: DATA_TYPE_COLORS[output.type] }}>
                    <span className="text-[10px] font-black uppercase tracking-[0.08em] text-black">{output.label}</span>
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={output.id}
                      className="!w-3 !h-3 !bg-white !border-[1.5px] !border-black !-right-[8px]"
                    />
                  </div>
                ))}
              </div>
            ) : null}

            {definition.category === "input" ? (
              <div className="mt-0.5 flex flex-col gap-2">
                {definition.name === "input_text" ? (
                  <textarea
                    placeholder="Enter text here..."
                    value={String(data.values.text ?? "")}
                    disabled={isNodeLocked}
                    onChange={(event) => context.updateNodeValues(id, { text: event.target.value })}
                    className="w-full h-[104px] text-[10px] p-2 border-[1.5px] border-black rounded-md bg-white font-medium outline-none resize-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                  />
                ) : (
                  <>
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      accept={`${definition.outputs[0]?.type ?? "*"}/*`}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void context.uploadNodeAsset(id, file);
                        }
                      }}
                    />
                    {renderMedia(preview, { onOpenVideo: openVideoPreview })}
                    <button
                      type="button"
                      disabled={isNodeLocked}
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-1.5 border-[1.5px] border-black rounded-md bg-white text-[10px] font-bold uppercase flex items-center justify-center gap-2 hover:bg-gray-100 transition-all disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                    >
                      <Upload size={12} strokeWidth={3} />
                      Upload
                    </button>
                  </>
                )}
              </div>
            ) : null}

            {definition.category === "output" ? <div className="mt-0.5">{renderMedia(preview, { onOpenVideo: openVideoPreview })}</div> : null}

            {definition.category === "processor" && activeWarning ? (
              <div className="text-[9px] font-bold leading-4 text-gray-500">
                {activeWarning}
              </div>
            ) : null}

            {definition.category === "processor" && execution.artifacts?.length ? (
              <div className="mt-0.5">
                <div className="mb-1 flex items-center justify-between text-[8px] font-black uppercase tracking-[0.18em] text-gray-500">
                  <span>Latest Result</span>
                  {execution.artifacts.length > 1 && <span className="opacity-60">{execution.artifacts.length} variants</span>}
                </div>
                {execution.artifacts.length > 1 ? (
                  <div className="grid grid-cols-2 gap-1 mb-1">
                    {execution.artifacts.map((artifact, index) => {
                      const isSelected = data.values.selectedArtifactId ? data.values.selectedArtifactId === artifact.assetId : index === 0;
                      return (
                        <button
                          key={artifact.assetId}
                          type="button"
                          disabled={isNodeLocked}
                          onClick={() => context.updateNodeValues(id, { selectedArtifactId: artifact.assetId })}
                          className={`relative aspect-square overflow-hidden rounded-md border-[2px] transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:hover:scale-100 ${isSelected ? "border-[#dcff39] shadow-[0_0_0_2px_#000]" : "border-black opacity-70 hover:opacity-100"}`}
                        >
                          {artifact.kind === "image" ? (
                            <img src={artifact.previewUrl} alt={artifact.filename} className="w-full h-full object-cover" />
                          ) : artifact.kind === "video" ? (
                            <VideoSurface artifact={artifact} compact />
                          ) : null}
                          {isSelected && <div className="absolute top-1 right-1 w-2.5 h-2.5 bg-[#dcff39] border-[1.5px] border-black rounded-full" />}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  renderMedia(preview, { onOpenVideo: openVideoPreview })
                )}
              </div>
            ) : null}

            {execution.error ? <div className="border-[1.5px] border-[#ff8d4d] rounded-xl bg-[#fff1e5] px-3 py-2 text-[9px] font-bold leading-4 text-[#cf5c00]">{execution.error}</div> : null}

            {execution.health ? (
              <div className="flex flex-col gap-0.5 text-[8px] font-bold leading-4 text-gray-500">
                {execution.status === "querying" ? <div>Task is still processing. Auto-refresh is active.</div> : null}
                {typeof execution.health.submitAttempts === "number" ? <div>Submit Attempts: {execution.health.submitAttempts}</div> : null}
                {typeof execution.health.queryAttempts === "number" ? <div>Query Attempts: {execution.health.queryAttempts}</div> : null}
                {execution.health.pendingReason ? <div>Health: {execution.health.pendingReason}</div> : null}
                {execution.health.logFile ? (
                  <div className="truncate" title={logTitle}>
                    Log: {execution.health.logFile}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {definition.category === "processor" ? (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <button
                type="button"
                disabled={isNodeLocked}
                onClick={() => void context.runNode(id)}
                className="bg-black text-white text-[9px] font-black uppercase py-2 rounded-md border-[1.5px] border-black hover:bg-gray-800 flex items-center justify-center gap-1 transition-colors disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                <Play size={12} fill="currentColor" />
                Run Node
              </button>
              <button
                type="button"
                disabled={isNodeLocked}
                onClick={() => void context.runChain(id)}
                className="bg-[#dcff39] text-black text-[9px] font-black uppercase py-2 rounded-md border-[1.5px] border-black hover:bg-[#d2f82d] transition-colors disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
              >
                Run Chain
              </button>
              {execution.submitId ? (
                <button
                  type="button"
                  onClick={() => void context.refreshNodeResult(id)}
                  className="col-span-2 bg-white text-black text-[9px] font-black uppercase py-2 rounded-md border-[1.5px] border-black hover:bg-gray-100 flex items-center justify-center gap-2 transition-colors"
                >
                  <RefreshCw size={12} />
                  Refresh Result
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {lightboxArtifact ? <VideoLightbox artifact={lightboxArtifact} onClose={() => setLightboxArtifact(null)} /> : null}
    </>
  );
}
