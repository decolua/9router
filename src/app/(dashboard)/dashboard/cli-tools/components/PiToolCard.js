"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
	Button,
	Card,
	ManualConfigModal,
	ModelSelectModal,
} from "@/shared/components";
import ApiKeySelect from "./ApiKeySelect";
import BaseUrlSelect from "./BaseUrlSelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";

function useModelAliases() {
	const [modelAliases, setModelAliases] = useState({});

	useEffect(() => {
		const ctrl = new AbortController();
		(async () => {
			try {
				const res = await fetch("/api/models/alias", { signal: ctrl.signal });
				const data = await res.json();
				if (!ctrl.signal.aborted && res.ok) {
					setModelAliases(data.aliases || {});
				}
			} catch (error) {
				if (error.name !== "AbortError") {
					console.log("Error fetching model aliases:", error);
				}
			}
		})();
		return () => ctrl.abort();
	}, []);

	return modelAliases;
}

function PiToolCardHeader({ tool, configStatus, isExpanded, onToggle }) {
	return (
		<div
			className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center"
			onClick={onToggle}
		>
			<div className="flex min-w-0 items-center gap-3">
				<div className="size-8 flex items-center justify-center shrink-0">
					<Image
						src="/providers/pi.png"
						alt={tool.name}
						width={32}
						height={32}
						className="size-8 object-contain rounded-lg"
						sizes="32px"
						onError={(e) => {
							e.target.style.display = "none";
						}}
						loading="lazy"
						decoding="async"
					/>
				</div>
				<div className="min-w-0">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<h3 className="font-medium text-sm">{tool.name}</h3>
						{configStatus === "configured" && (
							<span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">
								Connected
							</span>
						)}
						{configStatus === "not_configured" && (
							<span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-full">
								Not configured
							</span>
						)}
						{configStatus === "other" && (
							<span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">
								Other
							</span>
						)}
					</div>
					<p className="text-xs text-text-muted truncate">{tool.description}</p>
				</div>
			</div>
			<span
				className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}
			>
				expand_more
			</span>
		</div>
	);
}

function PiToolCardNotInstalled({
	showManualConfigModal,
	setShowManualConfigModal,
	showInstallGuide,
	setShowInstallGuide,
}) {
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
				<div className="flex items-start gap-3">
					<span className="material-symbols-outlined text-yellow-500">
						warning
					</span>
					<div className="flex-1">
						<p className="font-medium text-yellow-600 dark:text-yellow-400">
							Pi CLI not detected locally
						</p>
						<p className="text-sm text-text-muted">
							Manual configuration is still available if 9router is deployed on
							a remote server.
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2 pl-9">
					<Button
						variant="secondary"
						size="sm"
						onClick={() => setShowManualConfigModal(true)}
						className="!bg-yellow-500/20 !border-yellow-500/40 !text-yellow-700 dark:!text-yellow-300 hover:!bg-yellow-500/30"
					>
						<span className="material-symbols-outlined text-[18px] mr-1">
							content_copy
						</span>
						Manual Config
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setShowInstallGuide(!showInstallGuide)}
					>
						<span className="material-symbols-outlined text-[18px] mr-1">
							{showInstallGuide ? "expand_less" : "help"}
						</span>
						{showInstallGuide ? "Hide" : "How to Install"}
					</Button>
				</div>
			</div>
			{showInstallGuide && (
				<div className="p-4 bg-surface border border-border rounded-lg">
					<h4 className="font-medium mb-3">Installation Guide</h4>
					<div className="space-y-3 text-sm">
						<div>
							<p className="text-text-muted mb-1">macOS / Linux:</p>
							<code className="block px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs">
								npm install -g @earendil-works/pi-coding-agent
							</code>
						</div>
						<div>
							<p className="text-text-muted mb-1">Alternative (curl):</p>
							<code className="block px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs">
								curl -fsSL https://pi.dev/install.sh | sh
							</code>
						</div>
						<p className="text-text-muted">
							After installation, run{" "}
							<code className="px-1 bg-black/5 dark:bg-white/5 rounded">
								pi
							</code>{" "}
							to verify.
						</p>
					</div>
				</div>
			)}
		</div>
	);
}

function PiToolCardConfig({
	status,
	customBaseUrl,
	setCustomBaseUrl,
	getDisplayUrl,
	getEffectiveBaseUrl,
	tool,
	tunnelEnabled,
	tunnelPublicUrl,
	tailscaleEnabled,
	tailscaleUrl,
	selectedApiKey,
	setSelectedApiKey,
	apiKeys,
	cloudEnabled,
	selectedModels,
	setSelectedModels,
	activeProviders,
	setModalOpen,
	checkStatus,
}) {
	const removeModel = async (model) => {
		try {
			const res = await fetch(
				`/api/cli-tools/pi-settings?model=${encodeURIComponent(model)}`,
				{ method: "DELETE" },
			);
			if (res.ok) {
				setSelectedModels((prev) => prev.filter((m) => m !== model));
				checkStatus();
			}
		} catch (error) {
			console.log("Error removing model:", error);
		}
	};

	return (
		<div className="flex flex-col gap-2">
			<div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
				<span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
					Select Endpoint
				</span>
				<span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">
					arrow_forward
				</span>
				<BaseUrlSelect
					value={customBaseUrl || getDisplayUrl()}
					onChange={setCustomBaseUrl}
					requiresExternalUrl={tool.requiresExternalUrl}
					tunnelEnabled={tunnelEnabled}
					tunnelPublicUrl={tunnelPublicUrl}
					tailscaleEnabled={tailscaleEnabled}
					tailscaleUrl={tailscaleUrl}
				/>
			</div>

			{status?.config?.providers?.["9router"]?.baseUrl && (
				<div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
					<span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
						Current
					</span>
					<span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">
						arrow_forward
					</span>
					<span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
						{status.config.providers["9router"].baseUrl}
					</span>
				</div>
			)}

			<div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
				<span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
					API Key
				</span>
				<span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">
					arrow_forward
				</span>
				<ApiKeySelect
					value={selectedApiKey}
					onChange={setSelectedApiKey}
					apiKeys={apiKeys}
					cloudEnabled={cloudEnabled}
				/>
			</div>

			<div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
				<span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-1">
					Models
				</span>
				<span className="material-symbols-outlined text-text-muted text-[14px] mt-1.5">
					arrow_forward
				</span>
				<div className="flex-1 flex flex-col gap-2">
					<div className="flex flex-wrap gap-1.5 min-h-[28px] px-2 py-1.5 bg-surface rounded border border-border">
						{selectedModels.length === 0 ? (
							<span className="text-xs text-text-muted">
								No models selected
							</span>
						) : (
							selectedModels.map((model) => (
								<span
									key={model}
									className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-black/5 dark:bg-white/5 text-text-muted border border-transparent"
								>
									{model}
									<button
										onClick={() => removeModel(model)}
										className="ml-0.5 hover:text-red-500"
									>
										<span className="material-symbols-outlined text-[12px]">
											close
										</span>
									</button>
								</span>
							))
						)}
					</div>
					<button
						onClick={() => setModalOpen(true)}
						disabled={!activeProviders?.length}
						className={`w-fit px-2 py-1 rounded border text-xs transition-colors ${activeProviders?.length ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}
					>
						Add Model
					</button>
				</div>
			</div>
		</div>
	);
}

function PiToolCardMessage({ message }) {
	if (!message) return null;
	return (
		<div
			className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}
		>
			<span className="material-symbols-outlined text-[14px]">
				{message.type === "success" ? "check_circle" : "error"}
			</span>
			<span>{message.text}</span>
		</div>
	);
}

function PiToolCardActions({
	handleApply,
	selectedModels,
	applying,
	handleReset,
	status,
	restoring,
	setShowManualConfigModal,
}) {
	return (
		<div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
			<Button
				variant="primary"
				size="sm"
				onClick={handleApply}
				disabled={selectedModels.length === 0}
				loading={applying}
			>
				<span className="material-symbols-outlined text-[14px] mr-1">save</span>
				Apply
			</Button>
			<Button
				variant="outline"
				size="sm"
				onClick={handleReset}
				disabled={!status.has9Router}
				loading={restoring}
			>
				<span className="material-symbols-outlined text-[14px] mr-1">
					restore
				</span>
				Reset
			</Button>
			<Button
				variant="ghost"
				size="sm"
				onClick={() => setShowManualConfigModal(true)}
			>
				<span className="material-symbols-outlined text-[14px] mr-1">
					content_copy
				</span>
				Manual Config
			</Button>
		</div>
	);
}

export default function PiToolCard({
	tool,
	isExpanded,
	onToggle,
	baseUrl,
	apiKeys,
	activeProviders,
	cloudEnabled,
	initialStatus,
	tunnelEnabled,
	tunnelPublicUrl,
	tailscaleEnabled,
	tailscaleUrl,
}) {
	const [status, setStatus] = useState(initialStatus || null);
	const [checking, setChecking] = useState(false);
	const [applying, setApplying] = useState(false);
	const [restoring, setRestoring] = useState(false);
	const [message, setMessage] = useState(null);
	const [showInstallGuide, setShowInstallGuide] = useState(false);
	const [selectedApiKey, setSelectedApiKey] = useState("");
	const [modalOpen, setModalOpen] = useState(false);
	const [showManualConfigModal, setShowManualConfigModal] = useState(false);
	const [customBaseUrl, setCustomBaseUrl] = useState("");
	const [selectedModels, setSelectedModels] = useState([]);
	const selectedModelsRef = useRef([]);
	const modelAliases = useModelAliases();

	useEffect(() => {
		selectedModelsRef.current = selectedModels;
	}, [selectedModels]);

	useEffect(() => {
		if (apiKeys?.length > 0 && !selectedApiKey) {
			setSelectedApiKey(apiKeys[0].key);
		}
	}, [apiKeys, selectedApiKey]);

	useEffect(() => {
		if (initialStatus) setStatus(initialStatus);
	}, [initialStatus]);

	useEffect(() => {
		if (isExpanded && !status) checkStatus();
	}, [isExpanded]);

	useEffect(() => {
		if (status?.pi?.models) {
			setSelectedModels(status.pi.models);
		}
	}, [status]);

	const getConfigStatus = () => {
		if (!status?.installed) return null;
		if (!status.config) return "not_configured";
		if (!status.has9Router) return "not_configured";
		const url = status.config?.providers?.["9router"]?.baseUrl || "";
		return matchKnownEndpoint(url, { tunnelPublicUrl, tailscaleUrl })
			? "configured"
			: "other";
	};

	const configStatus = getConfigStatus();

	const getEffectiveBaseUrl = () => {
		const url = customBaseUrl || baseUrl;
		return url.endsWith("/v1") ? url : `${url}/v1`;
	};

	const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

	const checkStatus = async () => {
		setChecking(true);
		try {
			const res = await fetch("/api/cli-tools/pi-settings");
			const data = await res.json();
			setStatus(data);
		} catch (error) {
			setStatus({ installed: false, error: error.message });
		} finally {
			setChecking(false);
		}
	};

	const handleApply = async () => {
		setApplying(true);
		setMessage(null);
		try {
			const keyToUse =
				selectedApiKey && selectedApiKey.trim()
					? selectedApiKey
					: !cloudEnabled
						? "sk_9router"
						: selectedApiKey;

			const res = await fetch("/api/cli-tools/pi-settings", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					baseUrl: getEffectiveBaseUrl(),
					apiKey: keyToUse,
					models: selectedModels,
				}),
			});
			const data = await res.json();
			if (res.ok) {
				setMessage({ type: "success", text: "Settings applied successfully!" });
				checkStatus();
			} else {
				setMessage({
					type: "error",
					text: data.error || "Failed to apply settings",
				});
			}
		} catch (error) {
			setMessage({ type: "error", text: error.message });
		} finally {
			setApplying(false);
		}
	};

	const handleReset = async () => {
		setRestoring(true);
		setMessage(null);
		try {
			const res = await fetch("/api/cli-tools/pi-settings", {
				method: "DELETE",
			});
			const data = await res.json();
			if (res.ok) {
				setMessage({ type: "success", text: "Settings reset successfully!" });
				setSelectedModels([]);
				checkStatus();
			} else {
				setMessage({
					type: "error",
					text: data.error || "Failed to reset settings",
				});
			}
		} catch (error) {
			setMessage({ type: "error", text: error.message });
		} finally {
			setRestoring(false);
		}
	};

	const getManualConfigs = () => {
		const keyToUse =
			selectedApiKey && selectedApiKey.trim()
				? selectedApiKey
				: !cloudEnabled
					? "sk_9router"
					: "<API_KEY_FROM_DASHBOARD>";

		const modelsToShow =
			selectedModels.length > 0 ? selectedModels : ["provider/model-id"];

		return [
			{
				filename: "~/.pi/agent/models.json",
				content: JSON.stringify(
					{
						providers: {
							"9router": {
								baseUrl: getEffectiveBaseUrl(),
								api: "openai-completions",
								apiKey: keyToUse,
								models: modelsToShow.map((m) => ({
									id: m,
									input: ["text", "image"],
								})),
							},
						},
					},
					null,
					2,
				),
			},
		];
	};

	return (
		<Card padding="xs" className="overflow-hidden">
			<PiToolCardHeader
				tool={tool}
				configStatus={configStatus}
				isExpanded={isExpanded}
				onToggle={onToggle}
			/>

			{isExpanded && (
				<div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
					{checking && (
						<div className="flex items-center gap-2 text-text-muted">
							<span className="material-symbols-outlined animate-spin">
								progress_activity
							</span>
							<span>Checking Pi CLI...</span>
						</div>
					)}

					{!checking && status && !status.installed && (
						<PiToolCardNotInstalled
							showManualConfigModal={showManualConfigModal}
							setShowManualConfigModal={setShowManualConfigModal}
							showInstallGuide={showInstallGuide}
							setShowInstallGuide={setShowInstallGuide}
						/>
					)}

					{!checking && status?.installed && (
						<>
							<PiToolCardConfig
								status={status}
								customBaseUrl={customBaseUrl}
								setCustomBaseUrl={setCustomBaseUrl}
								getDisplayUrl={getDisplayUrl}
								getEffectiveBaseUrl={getEffectiveBaseUrl}
								tool={tool}
								tunnelEnabled={tunnelEnabled}
								tunnelPublicUrl={tunnelPublicUrl}
								tailscaleEnabled={tailscaleEnabled}
								tailscaleUrl={tailscaleUrl}
								selectedApiKey={selectedApiKey}
								setSelectedApiKey={setSelectedApiKey}
								apiKeys={apiKeys}
								cloudEnabled={cloudEnabled}
								selectedModels={selectedModels}
								setSelectedModels={setSelectedModels}
								activeProviders={activeProviders}
								setModalOpen={setModalOpen}
								checkStatus={checkStatus}
							/>

							<PiToolCardMessage message={message} />

							<PiToolCardActions
								handleApply={handleApply}
								selectedModels={selectedModels}
								applying={applying}
								handleReset={handleReset}
								status={status}
								restoring={restoring}
								setShowManualConfigModal={setShowManualConfigModal}
							/>
						</>
					)}
				</div>
			)}

			{modalOpen && (
				<ModelSelectModal
					isOpen={modalOpen}
					onClose={() => setModalOpen(false)}
					onSelect={(model) => {
						if (!selectedModels.includes(model.value)) {
							setSelectedModels([...selectedModels, model.value]);
						}
					}}
					onDeselect={(model) => {
						setSelectedModels((prev) => prev.filter((m) => m !== model.value));
					}}
					selectedModel={null}
					activeProviders={activeProviders}
					modelAliases={modelAliases}
					addedModelValues={selectedModels}
					closeOnSelect={false}
					title="Add Model for Pi"
				/>
			)}

			<ManualConfigModal
				isOpen={showManualConfigModal}
				onClose={() => setShowManualConfigModal(false)}
				title="Pi - Manual Configuration"
				configs={getManualConfigs()}
			/>
		</Card>
	);
}
