import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  type Connection,
  type Edge,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertCircle, ChevronRight, Download, FolderOpen, LayoutPanelTop, LoaderCircle, RefreshCw, UploadCloud } from "lucide-react";
import logoHeader from "../assets/brand/logo-header.webp";
import logoLoading from "../assets/brand/logo-loading.webp";
import { WorkflowNodeCard } from "../components/nodes/WorkflowNodeCard";
import { SystemStatusModal } from "../components/runtime/SystemStatusModal";
import { STATIC_NODE_DEFS } from "../config/workflowNodes";
import { WorkflowStudioProvider } from "../context/WorkflowStudioContext";
import { useAdapterStatus } from "../hooks/useAdapterStatus";
import { useFlowExecution } from "../hooks/useFlowExecution";
import { useSystemStatus } from "../hooks/useSystemStatus";
import { fetchCapabilities } from "../lib/api";
import { createDefaultParams, definitionMap } from "../lib/flow";
import { getLayoutedElements } from "../lib/layout";
import {
  buildWorkflowDownloadPayload,
  isWorkflowDocumentPreparationFailure,
  parseWorkflowDocumentText,
  prepareStarterWorkflowDocument,
  prepareWorkflowDocumentImport,
} from "../lib/workflowDocument";
import type {
  AdapterLoginSession,
  AdapterStatus,
  NodeExecution,
  NodeCatalogResponse,
  WorkflowCanvasEdge,
  WorkflowCanvasNode,
  WorkflowGroup,
  WorkflowMeta,
  WorkflowViewport,
} from "../types";

const nodeTypes = {
  studio: WorkflowNodeCard,
};

const EDGE_STYLE = { strokeWidth: 2.5, stroke: "#000" } as const;

type PaletteSectionProps = {
  title: string;
  nodes: Array<{ name: string; title: string; description: string }>;
  onAdd: (nodeType: string) => void;
};

function PaletteSection({ title, nodes, onAdd }: PaletteSectionProps) {
  return (
    <div className="min-w-[260px] rounded-[20px] border-[3px] border-black bg-[#fbfbf8] p-4 shadow-[3px_4px_0px_0px_rgba(0,0,0,1)] lg:min-w-0">
      <div className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-gray-500">{title}</div>
      <div className="grid max-h-[260px] gap-2 overflow-y-auto pr-1 lg:max-h-none lg:overflow-visible lg:pr-0">
        {nodes.map((node) => (
          <button
            key={node.name}
            type="button"
            onClick={() => onAdd(node.name)}
            className="rounded-xl border-[2px] border-black bg-white px-3 py-3 text-left transition-transform hover:translate-x-[1px] hover:translate-y-[1px]"
          >
            <div className="text-[12px] font-black">{node.title}</div>
            <div className="mt-1 text-[10px] font-medium text-gray-600">{node.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function creditSummary(runtimeStatus: AdapterStatus | null): string {
  const total = runtimeStatus?.auth.credits?.totalCredit;
  return typeof total === "number" ? total.toLocaleString("en-US") : "--";
}

function formatLastChecked(value: string | null | undefined): string {
  if (!value) {
    return "Not checked yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function AccountStatusCard({
  runtimeStatus,
  loginSession,
  isStartingLogin,
  pendingResume,
  onOpen,
}: {
  runtimeStatus: AdapterStatus | null;
  loginSession: AdapterLoginSession | null;
  isStartingLogin: boolean;
  pendingResume: boolean;
  onOpen: () => void;
}) {
  const isCliMissing = runtimeStatus?.cliFound === false;
  const isLoggedIn = Boolean(runtimeStatus?.auth.loggedIn);
  const effectiveLoginSucceeded = isLoggedIn || loginSession?.phase === "success";
  const isRefreshingLogin = loginSession?.phase === "success" && !isLoggedIn;
  const isLoginPending = !effectiveLoginSucceeded && (isStartingLogin || loginSession?.phase === "pending");
  const isLoginFailed = !effectiveLoginSucceeded && loginSession?.phase === "fail";

  let stateLabel = "需登录";
  let headline = "点击展开账户详情";
  let detail = "登录、积分和二维码都在这里。";
  let badgeClass = "bg-[#ffd9d0] text-[#8a201c]";
  let lampClass = "bg-[#ff5f52]";

  if (isCliMissing) {
    stateLabel = "CLI 缺失";
    headline = "先安装 Dreamina CLI";
    detail = "当前环境还没有可用的 dreamina 命令。";
    badgeClass = "bg-[#ece9de] text-[#45413b]";
    lampClass = "bg-[#7a756d]";
  } else if (isRefreshingLogin) {
    stateLabel = "刷新中";
    headline = "登录成功，正在刷新账户状态";
    detail = "打开卡片查看最新积分和登录详情。";
    badgeClass = "bg-[#fff1b8] text-[#8a5a00]";
    lampClass = "bg-[#ffb703]";
  } else if (isLoginPending) {
    stateLabel = "待扫码";
    headline = pendingResume
      ? "扫码后会自动继续刚才的操作"
      : "Headless 登录已启动";
    detail = "打开卡片查看二维码和登录进度。";
    badgeClass = "bg-[#fff1b8] text-[#8a5a00]";
    lampClass = "bg-[#ffb703]";
  } else if (isLoggedIn) {
    stateLabel = "已登录";
    headline = pendingResume
      ? "已恢复登录，稍后继续刚才的操作"
      : "Dreamina 账户已就绪";
    detail = "点击查看积分与登录详情。";
    badgeClass = "bg-[#d9ffd5] text-[#14532d]";
    lampClass = "bg-[#22c55e]";
  } else if (isLoginFailed) {
    stateLabel = "登录失败";
    headline = "上次 headless 登录没有完成";
    detail = "点击卡片重新发起 Dreamina 登录。";
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative min-w-[272px] rounded-[24px] border-[3px] border-black bg-[#fbfbf8] p-4 text-left shadow-[3px_4px_0px_0px_rgba(0,0,0,1)] transition-transform hover:translate-x-[1px] hover:translate-y-[1px] lg:min-w-0"
    >
      <div className="flex min-w-0 items-start gap-3 pr-12">
        <img
          src={logoHeader}
          alt="歪比巴布 Workflow Studio"
          className="mt-0.5 h-12 w-12 shrink-0 rounded-[16px] border-[3px] border-black bg-white object-cover shadow-[2px_3px_0px_0px_rgba(0,0,0,1)] sm:h-14 sm:w-14"
        />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">歪比巴布</div>
          <div className="mt-1 text-[18px] font-black leading-none sm:text-[20px]">Workflow Studio</div>

          <div className={`mt-3 inline-flex w-fit items-center gap-2 rounded-full border-[2px] border-black px-2.5 py-1 text-[9px] font-black tracking-[0.08em] ${badgeClass}`}>
            {isLoginPending || isRefreshingLogin ? (
              <LoaderCircle size={12} className="shrink-0 animate-spin" />
            ) : (
              <span className={`h-3 w-3 shrink-0 rounded-full border border-black ${lampClass}`} />
            )}
            <span>{stateLabel}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 pr-12">
        <div className="text-[12px] font-black leading-5">{headline}</div>
        <div className="mt-1 text-[10px] font-medium leading-4 text-gray-600">
          {detail}
        </div>
        <div className="mt-3 flex flex-col items-start gap-1 text-[11px] font-black">
          <div className="flex items-baseline gap-2">
            <span className="text-[8px] uppercase tracking-[0.16em] text-gray-500">Credits</span>
            <span>{creditSummary(runtimeStatus)}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[8px] uppercase tracking-[0.16em] text-gray-500">CLI</span>
            <span>{runtimeStatus?.cliFound ? (runtimeStatus.cliVersion ?? "Ready") : "Missing"}</span>
          </div>
        </div>
      </div>

      <div className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-[16px] border-[2px] border-black bg-white sm:h-11 sm:w-11 sm:rounded-[18px]">
        <ChevronRight size={18} strokeWidth={3} />
      </div>

      {pendingResume ? (
        <div className="mt-3 rounded-xl border-[2px] border-black bg-[#fff3c9] px-3 py-2 text-[9px] font-black uppercase tracking-[0.14em] text-[#8a5a00]">
          Login success will resume the latest blocked action from this canvas.
        </div>
      ) : null}
    </button>
  );
}

function WorkflowStudioInner() {
  const reactFlow = useReactFlow<WorkflowCanvasNode, WorkflowCanvasEdge>();
  const workflowFileInputRef = useRef<HTMLInputElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowCanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowCanvasEdge>([]);
  const [capabilities, setCapabilities] = useState<NodeCatalogResponse | null>(null);
  const [workflowMeta, setWorkflowMeta] = useState<WorkflowMeta | null>(null);
  const [workflowGroups, setWorkflowGroups] = useState<WorkflowGroup[]>([]);
  const [workflowWarnings, setWorkflowWarnings] = useState<string[]>([]);
  const [pendingViewport, setPendingViewport] = useState<WorkflowViewport | null>(null);
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState("");
  const [isResumingAction, setIsResumingAction] = useState(false);

  const reportGlobalError = useCallback((message: string) => {
    setGlobalError(message);
  }, []);

  const { runtimeStatus, refreshRuntimeStatus } = useAdapterStatus({ onError: reportGlobalError });
  const systemStatus = useSystemStatus({
    runtimeStatus,
    refreshRuntimeStatus,
    onError: reportGlobalError,
  });

  const definitions = useMemo(
    () => definitionMap([...(capabilities?.canvasNodes.input ?? []), ...(capabilities?.canvasNodes.processor ?? []), ...(capabilities?.canvasNodes.output ?? []), ...STATIC_NODE_DEFS]),
    [capabilities],
  );
  const processorNodes = capabilities?.canvasNodes.processor ?? [];
  const inputNodes = capabilities?.canvasNodes.input ?? STATIC_NODE_DEFS.filter((node) => node.category === "input");
  const outputNodes = capabilities?.canvasNodes.output ?? STATIC_NODE_DEFS.filter((node) => node.category === "output");

  const updateNodeValues = useCallback((nodeId: string, values: Record<string, unknown>) => {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === nodeId
          ? {
            ...node,
            data: {
              ...node.data,
              values: {
                ...node.data.values,
                ...values,
              },
            },
          }
          : node,
      ),
    );
  }, [setNodes]);

  const setNodeExecution = useCallback((nodeId: string, execution: Partial<NodeExecution>) => {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === nodeId
          ? {
            ...node,
            data: {
              ...node.data,
              execution: {
                ...node.data.execution,
                ...execution,
              },
            },
          }
          : node,
      ),
    );
  }, [setNodes]);

  const {
    uploadNodeAsset,
    runNode,
    refreshNodeResult,
    runChain,
  } = useFlowExecution({
    nodes,
    edges,
    definitions,
    setNodes,
    setNodeExecution,
    updateNodeValues,
    refreshRuntimeStatus,
    onError: reportGlobalError,
    onAuthRequired: systemStatus.handleAuthRequired,
  });

  const applyWorkflowImport = useCallback((warnings: string[], meta: WorkflowMeta, groups: WorkflowGroup[], nextNodes: WorkflowCanvasNode[], nextEdges: WorkflowCanvasEdge[], viewport: WorkflowViewport) => {
    setNodes(nextNodes);
    setEdges(nextEdges);
    setWorkflowMeta(meta);
    setWorkflowGroups(groups);
    setWorkflowWarnings(warnings);
    setPendingViewport(viewport);
  }, [setEdges, setNodes]);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        setLoading(true);
        const [nextCapabilities, nextRuntimeStatus] = await Promise.all([
          fetchCapabilities(),
          refreshRuntimeStatus(),
        ]);
        if (!active) {
          return;
        }
        setCapabilities(nextCapabilities);
        const nextDefinitions = definitionMap([...(nextCapabilities.canvasNodes.input ?? []), ...(nextCapabilities.canvasNodes.processor ?? []), ...(nextCapabilities.canvasNodes.output ?? []), ...STATIC_NODE_DEFS]);
        const starter = prepareStarterWorkflowDocument(nextDefinitions, nextRuntimeStatus);
        if (isWorkflowDocumentPreparationFailure(starter)) {
          throw new Error(starter.error);
        }
        applyWorkflowImport(
          starter.workflow.warnings,
          starter.workflow.meta,
          starter.workflow.groups,
          starter.workflow.nodes as WorkflowCanvasNode[],
          starter.workflow.edges as WorkflowCanvasEdge[],
          starter.workflow.viewport,
        );
      } catch (error) {
        setGlobalError(error instanceof Error ? error.message : "Failed to load workflow studio.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [applyWorkflowImport, refreshRuntimeStatus]);

  useEffect(() => {
    if (!pendingViewport) {
      return;
    }
    const timer = window.setTimeout(() => {
      reactFlow.setViewport(pendingViewport, { duration: 250 });
      setPendingViewport(null);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [pendingViewport, reactFlow]);

  useEffect(() => {
    if (!systemStatus.effectiveLoginSucceeded || !systemStatus.pendingResumeAction || isResumingAction) {
      return;
    }

    const nextAction = systemStatus.pendingResumeAction;
    setIsResumingAction(true);

    void (async () => {
      try {
        if (nextAction.kind === "runNode") {
          await runNode(nextAction.nodeId, { resumeAttempted: true });
          return;
        }
        await runChain(nextAction.nodeId, { resumeAttempted: true });
      } finally {
        systemStatus.clearPendingResumeAction();
        setIsResumingAction(false);
      }
    })();
  }, [
    isResumingAction,
    runChain,
    runNode,
    systemStatus.effectiveLoginSucceeded,
    systemStatus.clearPendingResumeAction,
    systemStatus.pendingResumeAction,
  ]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((currentEdges) => addEdge({ ...connection, type: "default", style: EDGE_STYLE } as Edge, currentEdges));
  }, [setEdges]);

  const addNode = useCallback((nodeType: string) => {
    const definition = definitions[nodeType];
    if (!definition) {
      return;
    }
    const nextId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const nextNode: WorkflowCanvasNode = {
      id: nextId,
      type: "studio",
      position: {
        x: 80 + (nodes.length % 3) * 320,
        y: 120 + Math.floor(nodes.length / 3) * 140,
      },
      data: {
        nodeType,
        params: definition.category === "processor" ? createDefaultParams(definition) : {},
        values: {},
        execution: { status: "idle", artifacts: [] },
      },
    };
    setNodes((current) => [...current, nextNode]);
  }, [definitions, nodes.length, setNodes]);

  const updateNodeParams = useCallback((nodeId: string, key: string, value: unknown) => {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === nodeId
          ? {
            ...node,
            data: {
              ...node.data,
              params: {
                ...node.data.params,
                [key]: value,
              },
            },
          }
          : node,
      ),
    );
  }, [setNodes]);

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== nodeId));
    setEdges((currentEdges) => currentEdges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
  }, [setEdges, setNodes]);

  const resetWorkflow = useCallback(() => {
    const starter = prepareStarterWorkflowDocument(definitions, runtimeStatus);
    if (isWorkflowDocumentPreparationFailure(starter)) {
      reportGlobalError(starter.error);
      return;
    }
    applyWorkflowImport(
      starter.workflow.warnings,
      starter.workflow.meta,
      starter.workflow.groups,
      starter.workflow.nodes as WorkflowCanvasNode[],
      starter.workflow.edges as WorkflowCanvasEdge[],
      starter.workflow.viewport,
    );
  }, [applyWorkflowImport, definitions, reportGlobalError, runtimeStatus]);

  const downloadWorkflow = useCallback(() => {
    const payload = buildWorkflowDownloadPayload({
      nodes,
      edges,
      meta: workflowMeta,
      groups: workflowGroups,
      viewport: reactFlow.getViewport(),
      definitions,
      status: runtimeStatus,
    });
    const url = URL.createObjectURL(new Blob([payload.json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = payload.filename;
    link.click();
    URL.revokeObjectURL(url);
  }, [definitions, edges, nodes, reactFlow, runtimeStatus, workflowGroups, workflowMeta]);

  const importWorkflowFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const payload = parseWorkflowDocumentText(text);
      const prepared = prepareWorkflowDocumentImport(payload, definitions, runtimeStatus);
      if (isWorkflowDocumentPreparationFailure(prepared)) {
        throw new Error(prepared.error);
      }
      applyWorkflowImport(
        prepared.workflow.warnings,
        prepared.workflow.meta,
        prepared.workflow.groups,
        prepared.workflow.nodes as WorkflowCanvasNode[],
        prepared.workflow.edges as WorkflowCanvasEdge[],
        prepared.workflow.viewport,
      );
    } catch (error) {
      reportGlobalError(error instanceof Error ? error.message : "Failed to import workflow.");
    }
  }, [applyWorkflowImport, definitions, reportGlobalError, runtimeStatus]);

  const autoLayout = useCallback(() => {
    const layouted = getLayoutedElements(nodes, edges);
    setNodes(layouted.nodes);
    setEdges(layouted.edges);
    window.setTimeout(() => {
      void reactFlow.fitView({ duration: 250, padding: 0.18 });
    }, 30);
  }, [edges, nodes, reactFlow, setEdges, setNodes]);

  return (
    <WorkflowStudioProvider
      value={{
        definitions,
        nodes,
        edges,
        runtimeStatus,
        runNode,
        runChain,
        refreshNodeResult,
        uploadNodeAsset,
        updateNodeParams,
        updateNodeValues,
        deleteNode,
        isSystemStatusOpen: systemStatus.isSystemStatusOpen,
        openSystemStatus: systemStatus.openSystemStatus,
        closeSystemStatus: systemStatus.closeSystemStatus,
        startAdapterLogin: systemStatus.beginLogin,
        adapterLoginSession: systemStatus.loginSession,
        pendingResumeAction: systemStatus.pendingResumeAction,
      }}
    >
      <div className="flex min-h-screen w-full flex-col bg-[linear-gradient(180deg,#f7f6ef_0%,#ebe8dd_100%)] text-black lg:h-screen lg:flex-row">
        <input
          ref={workflowFileInputRef}
          type="file"
          accept=".json,.workflow.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void importWorkflowFile(file);
            }
            event.target.value = "";
          }}
        />

        <SystemStatusModal
          open={systemStatus.isSystemStatusOpen}
          runtimeStatus={runtimeStatus}
          loginSession={systemStatus.loginSession}
          pendingResumeAction={systemStatus.pendingResumeAction}
          isStartingLogin={systemStatus.isStartingLogin}
          isLoggingOut={systemStatus.isLoggingOut}
          isResumingAction={isResumingAction}
          statusIntent={systemStatus.statusIntent}
          onClose={systemStatus.closeSystemStatus}
          onStartLogin={systemStatus.beginLogin}
          onLogout={systemStatus.performLogout}
        />

        <aside className="flex w-full shrink-0 gap-4 overflow-x-auto border-b-[3px] border-black p-4 lg:w-[296px] lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:border-b-0 lg:border-r-[3px] lg:p-5">
          <AccountStatusCard
            runtimeStatus={runtimeStatus}
            loginSession={systemStatus.loginSession}
            isStartingLogin={systemStatus.isStartingLogin}
            pendingResume={Boolean(systemStatus.pendingResumeAction)}
            onOpen={systemStatus.openSystemStatus}
          />

          <PaletteSection title="Inputs" nodes={inputNodes} onAdd={addNode} />
          <PaletteSection title="Processors" nodes={processorNodes} onAdd={addNode} />
          <PaletteSection title="Outputs" nodes={outputNodes} onAdd={addNode} />
        </aside>

        <main className="relative flex min-h-[68vh] min-w-0 flex-1 flex-col lg:min-h-0">
          <div className="flex flex-wrap items-center gap-3 border-b-[3px] border-black bg-[#fbfbf8] px-5 py-4">
            <button
              type="button"
              onClick={() => workflowFileInputRef.current?.click()}
              className="flex items-center gap-2 rounded-xl border-[2px] border-black bg-white px-3 py-2 text-[10px] font-black uppercase"
            >
              <FolderOpen size={14} />
              Upload Workflow
            </button>
            <button
              type="button"
              onClick={downloadWorkflow}
              className="flex items-center gap-2 rounded-xl border-[2px] border-black bg-white px-3 py-2 text-[10px] font-black uppercase"
            >
              <Download size={14} />
              Export
            </button>
            <button
              type="button"
              onClick={autoLayout}
              className="flex items-center gap-2 rounded-xl border-[2px] border-black bg-white px-3 py-2 text-[10px] font-black uppercase"
            >
              <LayoutPanelTop size={14} />
              Layout
            </button>
            <button
              type="button"
              onClick={resetWorkflow}
              className="flex items-center gap-2 rounded-xl border-[2px] border-black bg-[#dcff39] px-3 py-2 text-[10px] font-black uppercase"
            >
              <RefreshCw size={14} />
              Reset Starter
            </button>
          </div>

          {(globalError || workflowWarnings.length > 0) ? (
            <div className="flex flex-col gap-2 border-b-[3px] border-black bg-[#fff7e8] px-5 py-3">
              {globalError ? (
                <div className="flex items-start gap-2 text-[11px] font-bold text-[#b45309]">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{globalError}</span>
                </div>
              ) : null}
              {workflowWarnings.map((warning) => (
                <div key={warning} className="flex items-start gap-2 text-[10px] font-bold text-[#7c5b10]">
                  <UploadCloud size={14} className="mt-0.5 shrink-0" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="relative min-h-0 flex-1">
            {loading ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[radial-gradient(circle_at_top,#fff7d6_0%,#f1e8d1_50%,#ebe8dd_100%)] px-6">
                <div className="flex max-w-sm flex-col items-center rounded-[28px] border-[3px] border-black bg-[#fbfbf8] px-8 py-7 text-center shadow-[4px_5px_0px_0px_rgba(0,0,0,1)]">
                  <img
                    src={logoLoading}
                    alt="Loading 歪比巴布 Workflow Studio"
                    className="h-28 w-28 rounded-[24px] border-[3px] border-black bg-white object-cover shadow-[3px_4px_0px_0px_rgba(0,0,0,1)]"
                  />
                  <div className="mt-5 text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Loading Studio</div>
                  <div className="mt-2 text-[26px] font-black leading-none">歪比巴布Workflow Studio</div>
                  <div className="mt-3 text-[11px] font-medium leading-5 text-gray-600">
                    Loading the canvas, runtime snapshot, and starter workflow before you run nodes.
                  </div>
                </div>
              </div>
            ) : null}
            <ReactFlow<WorkflowCanvasNode, WorkflowCanvasEdge>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              fitView
              minZoom={0.2}
              defaultEdgeOptions={{ type: "default", style: EDGE_STYLE }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="#b7b19a" />
              <Controls />
            </ReactFlow>
          </div>
        </main>
      </div>
    </WorkflowStudioProvider>
  );
}

export function WorkflowStudio() {
  return (
    <ReactFlowProvider>
      <WorkflowStudioInner />
    </ReactFlowProvider>
  );
}
