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
			<div className="flex flex-col gap-8">
				<CardSkeleton />
				<CardSkeleton />
			</div>
		);
	}

	// ── render ───────────────────────────────────────────────────────────────────

	return (
		<div className="flex flex-col gap-8">
			{/* ── Groups section ─────────────────────────────────────────────────── */}
			<Card>
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-lg font-semibold flex items-center gap-2">
						<span className="material-symbols-outlined text-primary">
							group_work
						</span>
						Key Groups
					</h2>
					<Button icon="add" onClick={openCreate}>
						Create Group
					</Button>
				</div>

				{groups.length === 0 ? (
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
						<Button icon="add" onClick={openCreate}>
							Create Group
						</Button>
					</div>
				) : (
					<div className="flex flex-col gap-3">
						{groups.map((group) => {
							const groupKeyCount = keysInGroup(group.id).length;
							const allowedIds = group.allowedConnectionIds ?? [];
							return (
								<div
									key={group.id}
									className="flex items-start justify-between p-4 rounded-lg border border-border bg-surface-1 hover:bg-surface-2 transition-colors"
								>
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2 flex-wrap">
											<p className="font-medium text-text-main">{group.name}</p>
											<Badge variant="info" icon="cable">
												{allowedIds.length} connection
												{allowedIds.length !== 1 ? "s" : ""}
											</Badge>
											<Badge variant="primary" icon="vpn_key">
												{groupKeyCount} key{groupKeyCount !== 1 ? "s" : ""}
											</Badge>
										</div>
										{group.description && (
											<p className="text-sm text-text-muted mt-1">
												{group.description}
											</p>
										)}
										{allowedIds.length > 0 && (
											<div className="flex flex-wrap gap-1.5 mt-2">
												{allowedIds.map((cid) => {
													const conn = connectionById(cid);
													return (
														<span
															key={cid}
															className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-2 text-text-muted border border-border"
														>
															<span className="material-symbols-outlined text-[12px]">
																dns
															</span>
															{conn ? `${conn.name} (${conn.provider})` : cid}
														</span>
													);
												})}
											</div>
										)}
									</div>
									<div className="flex items-center gap-1 ml-4 shrink-0">
										<button
											onClick={() => openEdit(group)}
											className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors"
											title="Edit group"
										>
											<span className="material-symbols-outlined text-[18px]">
												edit
											</span>
										</button>
										<button
											onClick={() => setConfirmDelete(group.id)}
											className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors"
											title="Delete group"
										>
											<span className="material-symbols-outlined text-[18px]">
												delete
											</span>
										</button>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</Card>

			{/* ── API Keys section ────────────────────────────────────────────────── */}
			<Card>
				<h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
					<span className="material-symbols-outlined text-primary">
						vpn_key
					</span>
					API Key Assignments
				</h2>
				<p className="text-sm text-text-muted mb-4">
					Assign each API key to a group to restrict which provider connections
					it can use.
				</p>

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
								<div className="flex-1 min-w-0">
									<p className="text-sm font-medium text-text-main">
										{key.name}
									</p>
									<code className="text-xs text-text-muted font-mono">
										{maskKey(key.key)}
									</code>
								</div>
								<div className="shrink-0 w-48">
									<select
										value={key.groupId ?? ""}
										onChange={(e) =>
											handleKeyGroupChange(key.id, e.target.value)
										}
										className="w-full text-sm rounded-md border border-border bg-input text-text-main px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
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
