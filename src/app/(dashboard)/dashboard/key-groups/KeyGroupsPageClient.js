"use client";

import { useState, useEffect } from "react";
import {
	Card,
	Button,
	Input,
	Modal,
	Badge,
	CardSkeleton,
	ConfirmModal,
} from "@/shared/components";

// ── helpers ──────────────────────────────────────────────────────────────────

function maskKey(fullKey) {
	if (!fullKey) return "";
	return fullKey.length > 8 ? fullKey.slice(0, 8) + "..." : fullKey;
}

// ── main component ────────────────────────────────────────────────────────────

export default function KeyGroupsPageClient() {
	const [groups, setGroups] = useState([]);
	const [keys, setKeys] = useState([]);
	const [connections, setConnections] = useState([]);
	const [loading, setLoading] = useState(true);

	const [showCreateModal, setShowCreateModal] = useState(false);
	const [showEditModal, setShowEditModal] = useState(false);
	const [editingGroup, setEditingGroup] = useState(null);
	const [confirmDelete, setConfirmDelete] = useState(null); // group id or null

	// form state
	const [formName, setFormName] = useState("");
	const [formDescription, setFormDescription] = useState("");
	const [formAllowedConnectionIds, setFormAllowedConnectionIds] = useState([]);
	const [formSelectedKeyIds, setFormSelectedKeyIds] = useState([]);

	// ── fetch ───────────────────────────────────────────────────────────────────

	const fetchAll = async () => {
		try {
			const [groupsRes, keysRes, connectionsRes] = await Promise.all([
				fetch("/api/key-groups"),
				fetch("/api/keys"),
				fetch("/api/providers"),
			]);
			const [groupsData, keysData, connectionsData] = await Promise.all([
				groupsRes.json(),
				keysRes.json(),
				connectionsRes.json(),
			]);
			setGroups(groupsData.groups ?? []);
			setKeys(keysData.keys ?? []);
			setConnections(connectionsData.connections ?? []);
		} catch (err) {
			console.error("Error fetching key groups data:", err);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchAll();
	}, []);

	// ── form helpers ────────────────────────────────────────────────────────────

	const resetForm = () => {
		setFormName("");
		setFormDescription("");
		setFormAllowedConnectionIds([]);
		setFormSelectedKeyIds([]);
	};

	const openCreate = () => {
		resetForm();
		setShowCreateModal(true);
	};

	const openEdit = (group) => {
		setEditingGroup(group);
		setFormName(group.name ?? "");
		setFormDescription(group.description ?? "");
		setFormAllowedConnectionIds(group.allowedConnectionIds ?? []);
		const currentKeyIds = (keys || [])
			.filter((k) => k.groupId === group.id)
			.map((k) => k.id);
		setFormSelectedKeyIds(currentKeyIds);
		setShowEditModal(true);
	};

	const toggleConnectionId = (id) => {
		setFormAllowedConnectionIds((prev) =>
			prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
		);
	};

	const toggleKeyId = (id) => {
		setFormSelectedKeyIds((prev) =>
			prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
		);
	};

	// ── CRUD ────────────────────────────────────────────────────────────────────

	const handleCreate = async () => {
		if (!formName.trim()) return;
		try {
			const res = await fetch("/api/key-groups", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: formName.trim(),
					description: formDescription.trim(),
					allowedConnectionIds: formAllowedConnectionIds,
				}),
			});
			const data = await res.json();
			if (res.ok) {
				await Promise.all(
					formSelectedKeyIds.map((keyId) =>
						fetch(`/api/keys/${keyId}`, {
							method: "PUT",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ groupId: data.group.id }),
						}),
					),
				);
				await fetchAll();
				resetForm();
				setShowCreateModal(false);
			}
		} catch (err) {
			console.error("Error creating group:", err);
		}
	};

	const handleEdit = async () => {
		if (!formName.trim() || !editingGroup) return;
		try {
			const res = await fetch(`/api/key-groups/${editingGroup.id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: formName.trim(),
					description: formDescription.trim(),
					allowedConnectionIds: formAllowedConnectionIds,
				}),
			});
			if (res.ok) {
				const prevKeyIds = (keys || [])
					.filter((k) => k.groupId === editingGroup.id)
					.map((k) => k.id);
				const toUnassign = prevKeyIds.filter(
					(id) => !formSelectedKeyIds.includes(id),
				);
				const toAssign = formSelectedKeyIds.filter(
					(id) => !prevKeyIds.includes(id),
				);
				await Promise.all([
					...toAssign.map((keyId) =>
						fetch(`/api/keys/${keyId}`, {
							method: "PUT",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ groupId: editingGroup.id }),
						}),
					),
					...toUnassign.map((keyId) =>
						fetch(`/api/keys/${keyId}`, {
							method: "PUT",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ groupId: null }),
						}),
					),
				]);
				await fetchAll();
				setShowEditModal(false);
				setEditingGroup(null);
				resetForm();
			}
		} catch (err) {
			console.error("Error editing group:", err);
		}
	};

	const handleDelete = async (id) => {
		try {
			const res = await fetch(`/api/key-groups/${id}`, { method: "DELETE" });
			if (res.ok) {
				await fetchAll();
			}
		} catch (err) {
			console.error("Error deleting group:", err);
		} finally {
			setConfirmDelete(null);
		}
	};

	const handleKeyGroupChange = async (keyId, groupId) => {
		try {
			const res = await fetch(`/api/keys/${keyId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ groupId: groupId || null }),
			});
			if (res.ok) {
				setKeys((prev) =>
					prev.map((k) =>
						k.id === keyId ? { ...k, groupId: groupId || null } : k,
					),
				);
			}
		} catch (err) {
			console.error("Error assigning key to group:", err);
		}
	};

	// ── derived ─────────────────────────────────────────────────────────────────

	const keysInGroup = (groupId) => keys.filter((k) => k.groupId === groupId);

	const connectionById = (id) =>
		connections.find((c) => String(c.id) === String(id));

	// ── loading ──────────────────────────────────────────────────────────────────

	if (loading) {
		return (
			<div className="flex flex-col gap-6">
				<CardSkeleton />
				<CardSkeleton />
			</div>
		);
	}

	// ── render ───────────────────────────────────────────────────────────────────

	return (
		<div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
			{/* ── Page header — same pattern as Combos ──────────────────────────── */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<h1 className="text-2xl font-semibold">Key Groups</h1>
					<p className="text-sm text-text-muted mt-1">
						Group API keys and restrict which provider connections they can use
					</p>
				</div>
				<Button icon="add" onClick={openCreate} className="w-full sm:w-auto">
					Create Group
				</Button>
			</div>

			{/* ── Groups list ───────────────────────────────────────────────────── */}
			{groups.length === 0 ? (
				<Card>
					<div className="text-center py-12">
						<div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
							<span className="material-symbols-outlined text-[32px]">
								group_work
							</span>
						</div>
						<p className="text-text-main font-medium mb-1">No key groups yet</p>
						<p className="text-sm text-text-muted mb-4">
							Create a group to control which provider connections an API key
							can use
						</p>
						<Button
							icon="add"
							onClick={openCreate}
							className="w-full sm:w-auto"
						>
							Create Group
						</Button>
					</div>
				</Card>
			) : (
				<div className="flex flex-col gap-4">
					{groups.map((group) => {
						const groupKeyCount = keysInGroup(group.id).length;
						const allowedIds = group.allowedConnectionIds ?? [];
						return (
							<Card key={group.id} padding="sm" className="group">
								<div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
									<div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
										<div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
											<span className="material-symbols-outlined text-primary text-[18px]">
												group_work
											</span>
										</div>
										<div className="min-w-0 flex-1">
											<p className="font-medium text-text-main truncate">
												{group.name}
											</p>
											<div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
												<Badge variant="default" size="sm">
													{allowedIds.length} connection
													{allowedIds.length !== 1 ? "s" : ""}
												</Badge>
												<Badge variant="default" size="sm">
													{groupKeyCount} key{groupKeyCount !== 1 ? "s" : ""}
												</Badge>
												{group.description && (
													<span className="text-xs text-text-muted truncate max-w-[240px]">
														{group.description}
													</span>
												)}
											</div>
											{allowedIds.length > 0 && (
												<div className="flex flex-wrap gap-1 mt-1.5">
													{allowedIds.map((cid) => {
														const conn = connectionById(cid);
														return (
															<code
																key={cid}
																className="max-w-full truncate rounded bg-black/5 px-1.5 py-0.5 font-mono text-[10px] text-text-muted dark:bg-white/5 sm:max-w-[200px]"
															>
																{conn ? `${conn.name} (${conn.provider})` : cid}
															</code>
														);
													})}
												</div>
											)}
										</div>
									</div>
									<div className="grid grid-cols-2 gap-1 sm:flex">
										<button
											onClick={() => openEdit(group)}
											className="flex flex-col items-center rounded px-2 py-1 text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
										>
											<span className="material-symbols-outlined text-[18px]">
												edit
											</span>
											<span className="text-[10px] leading-tight">Edit</span>
										</button>
										<button
											onClick={() => setConfirmDelete(group.id)}
											className="flex flex-col items-center rounded px-2 py-1 text-red-500 hover:bg-red-500/10"
										>
											<span className="material-symbols-outlined text-[18px]">
												delete
											</span>
											<span className="text-[10px] leading-tight">Delete</span>
										</button>
									</div>
								</div>
							</Card>
						);
					})}
				</div>
			)}

			{/* ── API Keys section ───────────────────────────────────────────────── */}
			<Card>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
					<div>
						<h2 className="text-lg font-semibold">API Key Assignments</h2>
						<p className="text-sm text-text-muted mt-0.5">
							Assign keys to groups to restrict provider access
						</p>
					</div>
				</div>
				{keys.length === 0 ? (
					<div className="text-center py-8">
						<p className="text-text-muted text-sm">
							No API keys found. Create keys on the Endpoint page.
						</p>
					</div>
				) : (
					<div className="flex flex-col">
						{keys.map((key) => (
							<div
								key={key.id}
								className="flex items-center justify-between py-3 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0 gap-4"
							>
								<div className="flex min-w-0 flex-1 items-center gap-3">
									<div className="size-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
										<span className="material-symbols-outlined text-primary text-[15px]">
											vpn_key
										</span>
									</div>
									<div className="min-w-0">
										<p className="text-sm font-medium text-text-main truncate">
											{key.name}
										</p>
										<code className="text-[10px] text-text-muted font-mono">
											{maskKey(key.key)}
										</code>
									</div>
								</div>
								<div className="shrink-0 w-44">
									<select
										value={key.groupId ?? ""}
										onChange={(e) =>
											handleKeyGroupChange(key.id, e.target.value)
										}
										className="w-full text-sm rounded-lg border border-border bg-bg-input px-3 py-1.5 text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
									>
										<option value="">No group</option>
										{groups.map((g) => (
											<option key={g.id} value={g.id}>
												{g.name}
											</option>
										))}
									</select>
								</div>
							</div>
						))}
					</div>
				)}
			</Card>

			{/* ── Create Modal ────────────────────────────────────────────────────── */}
			<Modal
				isOpen={showCreateModal}
				title="Create Key Group"
				onClose={() => {
					setShowCreateModal(false);
					resetForm();
				}}
			>
				<GroupForm
					formName={formName}
					formDescription={formDescription}
					formAllowedConnectionIds={formAllowedConnectionIds}
					connections={connections}
					keys={keys || []}
					formSelectedKeyIds={formSelectedKeyIds}
					toggleKeyId={toggleKeyId}
					editingGroup={null}
					onNameChange={(e) => setFormName(e.target.value)}
					onDescriptionChange={(e) => setFormDescription(e.target.value)}
					onToggleConnection={toggleConnectionId}
					onSubmit={handleCreate}
					onCancel={() => {
						setShowCreateModal(false);
						resetForm();
					}}
					submitLabel="Create Group"
				/>
			</Modal>

			{/* ── Edit Modal ──────────────────────────────────────────────────────── */}
			<Modal
				isOpen={showEditModal}
				title="Edit Key Group"
				onClose={() => {
					setShowEditModal(false);
					setEditingGroup(null);
					resetForm();
				}}
			>
				<GroupForm
					formName={formName}
					formDescription={formDescription}
					formAllowedConnectionIds={formAllowedConnectionIds}
					connections={connections}
					keys={keys || []}
					formSelectedKeyIds={formSelectedKeyIds}
					toggleKeyId={toggleKeyId}
					editingGroup={editingGroup}
					onNameChange={(e) => setFormName(e.target.value)}
					onDescriptionChange={(e) => setFormDescription(e.target.value)}
					onToggleConnection={toggleConnectionId}
					onSubmit={handleEdit}
					onCancel={() => {
						setShowEditModal(false);
						setEditingGroup(null);
						resetForm();
					}}
					submitLabel="Save Changes"
				/>
			</Modal>

			{/* ── Delete Confirm ──────────────────────────────────────────────────── */}
			<ConfirmModal
				isOpen={confirmDelete !== null}
				title="Delete Key Group"
				message="Delete this group? Keys assigned to it will be unassigned."
				confirmLabel="Delete"
				onConfirm={() => handleDelete(confirmDelete)}
				onClose={() => setConfirmDelete(null)}
			/>
		</div>
	);
}

// ── GroupForm sub-component ───────────────────────────────────────────────────

function GroupForm({
	formName,
	formDescription,
	formAllowedConnectionIds,
	connections,
	keys,
	formSelectedKeyIds,
	toggleKeyId,
	editingGroup,
	onNameChange,
	onDescriptionChange,
	onToggleConnection,
	onSubmit,
	onCancel,
	submitLabel,
}) {
	return (
		<div className="flex flex-col gap-4">
			<Input
				label="Group Name"
				value={formName}
				onChange={onNameChange}
				placeholder="e.g. Production Keys"
			/>
			<Input
				label="Description"
				value={formDescription}
				onChange={onDescriptionChange}
				placeholder="Optional description"
			/>

			<div>
				<p className="text-sm font-medium text-text-main mb-2">
					Allowed Connections
				</p>
				{connections.length === 0 ? (
					<p className="text-sm text-text-muted">
						No provider connections available.
					</p>
				) : (
					<div className="flex flex-col gap-1 max-h-56 overflow-y-auto rounded-md border border-border p-2">
						{connections.map((conn) => {
							const id = String(conn.id);
							const checked = formAllowedConnectionIds.includes(id);
							return (
								<label
									key={id}
									className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-surface-2 cursor-pointer select-none"
								>
									<input
										type="checkbox"
										checked={checked}
										onChange={() => onToggleConnection(id)}
										className="accent-primary w-4 h-4 rounded"
									/>
									<span className="flex-1 text-sm text-text-main">
										{conn.name}
									</span>
									<span className="text-xs text-text-muted font-mono">
										{conn.provider}
									</span>
								</label>
							);
						})}
					</div>
				)}
				{formAllowedConnectionIds.length > 0 && (
					<p className="text-xs text-text-muted mt-1">
						{formAllowedConnectionIds.length} connection
						{formAllowedConnectionIds.length !== 1 ? "s" : ""} selected
					</p>
				)}
			</div>

			{(keys || []).length > 0 && (
				<div className="flex flex-col gap-2">
					<label className="text-sm font-medium text-text-main">
						Assign API Keys
					</label>
					<div className="max-h-40 overflow-y-auto flex flex-col gap-1 rounded-lg border border-border p-2">
						{(keys || []).map((k) => (
							<label
								key={k.id}
								className="flex items-center gap-2 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded px-1 py-0.5"
							>
								<input
									type="checkbox"
									checked={formSelectedKeyIds.includes(k.id)}
									onChange={() => toggleKeyId(k.id)}
									className="accent-primary"
								/>
								<span className="text-sm">{k.name}</span>
								{k.groupId && k.groupId !== editingGroup?.id && (
									<span className="text-xs text-yellow-500">
										(in another group)
									</span>
								)}
							</label>
						))}
					</div>
					<p className="text-xs text-text-muted">
						Keys already in another group will be moved to this group.
					</p>
				</div>
			)}

			<div className="flex gap-2 pt-2">
				<Button onClick={onSubmit} fullWidth disabled={!formName.trim()}>
					{submitLabel}
				</Button>
				<Button variant="ghost" onClick={onCancel} fullWidth>
					Cancel
				</Button>
			</div>
		</div>
	);
}
