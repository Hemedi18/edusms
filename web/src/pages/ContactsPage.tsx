import React, { useCallback, useEffect, useState } from "react";
import {
  Users,
  UserPlus,
  Upload,
  Download,
  ShieldCheck,
  ShieldBan,
  Eye,
  Trash2,
  Edit3,
  FolderPlus,
  CheckCircle2,
  XCircle,
  PhoneCall,
} from "lucide-react";
import { api, unwrapList } from "../api/client";
import type {
  ContactGroupRecord,
  ContactRecord,
  EffectiveContactPolicy,
  SuppressionRecord,
} from "../types/api";
import { PageHeader, LoadingSkeleton, EmptyState, ErrorState } from "../components/States";
import { Modal } from "../components/Modal";
import { useToast } from "../contexts/ToastContext";

export function ContactsPage() {
  const toast = useToast();

  const [tab, setTab] = useState<"contacts" | "groups" | "suppressions" | "normalizer">("contacts");
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [optFilter, setOptFilter] = useState<"" | "opted_in" | "opted_out" | "virtual">("");

  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [groups, setGroups] = useState<ContactGroupRecord[]>([]);
  const [suppressions, setSuppressions] = useState<SuppressionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Contact Create/Edit Modal
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactRecord | null>(null);
  const [cName, setCName] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cNotes, setCNotes] = useState("");
  const [cIsVirtual, setCIsVirtual] = useState(false);
  const [cOptIn, setCOptIn] = useState(true);
  const [cAllowOutgoing, setCAllowOutgoing] = useState(true);
  const [cGroupIds, setCGroupIds] = useState<string[]>([]);
  const [savingContact, setSavingContact] = useState(false);

  // CSV Import Modal
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState("name,phone_number,email,notes\nAmina Mwakasege,0754100201,amina@uni.ac.tz,CS101\nJuma Kikwete,+255713200302,juma@uni.ac.tz,CS101");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [markOptedIn, setMarkOptedIn] = useState(true);
  const [importVirtual, setImportVirtual] = useState(false);
  const [importGroupIds, setImportGroupIds] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<Record<string, unknown> | null>(null);

  // Effective Policy Preview Modal
  const [policyPreview, setPolicyPreview] = useState<EffectiveContactPolicy | null>(null);

  // Group Modal & Member Modal
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ContactGroupRecord | null>(null);
  const [gName, setGName] = useState("");
  const [gDesc, setGDesc] = useState("");
  const [gColor, setGColor] = useState("#7C3AED");
  const [gAllowOut, setGAllowOut] = useState(true);
  const [gAllowAuto, setGAllowAuto] = useState(true);
  const [gAllowAi, setGAllowAi] = useState(true);
  const [gCooldown, setGCooldown] = useState(15);
  const [memberModalGroup, setMemberModalGroup] = useState<ContactGroupRecord | null>(null);

  // Suppression create
  const [supPhone, setSupPhone] = useState("");
  const [supReason, setSupReason] = useState<SuppressionRecord["reason"]>("manual_block");
  const [supNotes, setSupNotes] = useState("");

  // Normalizer
  const [normInput, setNormInput] = useState("0754 100 201\n+255713200302\n255655300403\ninvalid_num");
  const [normResults, setNormResults] = useState<
    Array<{ input: string; normalized: string | null; valid: boolean; duplicate?: boolean; error?: string }>
  >([]);

  const loadAll = useCallback(async () => {
    setError(null);
    const qs = new URLSearchParams();
    if (search.trim()) qs.set("search", search.trim());
    if (groupFilter) qs.set("group_id", groupFilter);
    if (optFilter === "opted_in") qs.set("opt_in_status", "true");
    if (optFilter === "opted_out") qs.set("opt_out_status", "true");
    if (optFilter === "virtual") qs.set("is_virtual", "true");

    try {
      const [cRes, gRes, sRes] = await Promise.all([
        api.get<ContactRecord[] | { results: ContactRecord[] }>(`/contacts/?${qs.toString()}`),
        api.get<ContactGroupRecord[] | { results: ContactGroupRecord[] }>("/groups/"),
        api.get<SuppressionRecord[] | { results: SuppressionRecord[] }>("/suppressions/"),
      ]);
      setContacts(unwrapList<ContactRecord>(cRes as ContactRecord[]));
      setGroups(unwrapList<ContactGroupRecord>(gRes as ContactGroupRecord[]));
      setSuppressions(unwrapList<SuppressionRecord>(sRes as SuppressionRecord[]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load contacts.");
    } finally {
      setLoading(false);
    }
  }, [search, groupFilter, optFilter]);

  useEffect(() => {
    setLoading(true);
    void loadAll();
  }, [loadAll]);

  const openCreateContact = () => {
    setEditingContact(null);
    setCName("");
    setCPhone("+255");
    setCEmail("");
    setCNotes("");
    setCIsVirtual(false);
    setCOptIn(true);
    setCAllowOutgoing(true);
    setCGroupIds([]);
    setContactModalOpen(true);
  };

  const openEditContact = (c: ContactRecord) => {
    setEditingContact(c);
    setCName(c.name);
    setCPhone(c.phone_number);
    setCEmail(c.email || "");
    setCNotes(c.notes || "");
    setCIsVirtual(c.is_virtual);
    setCOptIn(c.opt_in_status);
    setCAllowOutgoing(c.allow_outgoing);
    setCGroupIds(c.groups.map((g) => g.id));
    setContactModalOpen(true);
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cName.trim() || !cPhone.trim()) return;
    setSavingContact(true);
    try {
      const payload = {
        name: cName.trim(),
        phone_number: cPhone.trim(),
        email: cEmail.trim(),
        notes: cNotes.trim(),
        is_virtual: cIsVirtual,
        opt_in_status: cOptIn,
        allow_outgoing: cAllowOutgoing,
        group_ids: cGroupIds,
      };
      if (editingContact) {
        await api.patch(`/contacts/${editingContact.id}/`, payload);
        toast.success("Contact Updated", `${cName} saved.`);
      } else {
        await api.post("/contacts/", payload);
        toast.success("Contact Created", `${cName} added with normalized E.164 phone.`);
      }
      setContactModalOpen(false);
      await loadAll();
    } catch (err) {
      toast.error("Save failed", err instanceof Error ? err.message : "Invalid contact details.");
    } finally {
      setSavingContact(false);
    }
  };

  const handleDeleteContact = async (c: ContactRecord) => {
    try {
      await api.delete(`/contacts/${c.id}/`);
      toast.info("Contact Removed", c.name);
      await loadAll();
    } catch (err) {
      toast.error("Delete failed", err instanceof Error ? err.message : "Could not delete contact.");
    }
  };

  const handleOptToggle = async (c: ContactRecord, action: "opt-in" | "opt-out") => {
    try {
      await api.post(`/contacts/${c.id}/${action}/`, {
        note: `Manual ${action} from Contacts dashboard`,
      });
      toast.success(
        action === "opt-in" ? "Contact Opted In" : "Contact Opted Out & Suppressed",
        `${c.name} (${c.phone_number})`
      );
      await loadAll();
    } catch (err) {
      toast.error("Consent update failed", err instanceof Error ? err.message : "Could not update consent.");
    }
  };

  const handleInspectPolicy = async (c: ContactRecord) => {
    try {
      const pol = await api.get<EffectiveContactPolicy>(`/contacts/${c.id}/effective-policy/`);
      setPolicyPreview(pol);
    } catch (err) {
      toast.error("Failed to load policy", err instanceof Error ? err.message : "Request failed.");
    }
  };

  const handleImportCsv = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consentConfirmed) {
      toast.warning("Consent Confirmation Required", "Confirm explicit recipient authorization before importing.");
      return;
    }
    setImporting(true);
    try {
      const summary = await api.post<Record<string, unknown>>("/contacts/import-csv/", {
        csv_text: csvText,
        consent_confirmed: true,
        mark_opted_in: markOptedIn,
        is_virtual: importVirtual,
        group_ids: importGroupIds,
      });
      setImportSummary(summary);
      toast.success("CSV Import Complete", `Created ${String(summary.created_count || 0)} contacts.`);
      await loadAll();
    } catch (err) {
      toast.error("CSV Import Failed", err instanceof Error ? err.message : "Invalid CSV.");
    } finally {
      setImporting(false);
    }
  };

  const handleExportCsv = async () => {
    try {
      await api.downloadFile("/contacts/export-csv/?include_opted_out=true", "edusms_contacts.csv");
      toast.success("CSV Export Downloaded");
    } catch (err) {
      toast.error("Export failed", err instanceof Error ? err.message : "Could not download CSV.");
    }
  };

  const openGroupModal = (grp?: ContactGroupRecord) => {
    if (grp) {
      setEditingGroup(grp);
      setGName(grp.name);
      setGDesc(grp.description);
      setGColor(grp.color || "#7C3AED");
      setGAllowOut(grp.allow_outgoing);
      setGAllowAuto(grp.allow_auto_reply);
      setGAllowAi(grp.allow_ai_reply);
      setGCooldown(grp.cooldown_minutes);
    } else {
      setEditingGroup(null);
      setGName("");
      setGDesc("");
      setGColor("#7C3AED");
      setGAllowOut(true);
      setGAllowAuto(true);
      setGAllowAi(true);
      setGCooldown(15);
    }
    setGroupModalOpen(true);
  };

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gName.trim()) return;
    try {
      const payload = {
        name: gName.trim(),
        description: gDesc.trim(),
        color: gColor,
        allow_outgoing: gAllowOut,
        allow_auto_reply: gAllowAuto,
        allow_ai_reply: gAllowAi,
        cooldown_minutes: gCooldown,
      };
      if (editingGroup) {
        await api.patch(`/groups/${editingGroup.id}/`, payload);
        toast.success("Group Updated", gName);
      } else {
        await api.post("/groups/", payload);
        toast.success("Group Created", gName);
      }
      setGroupModalOpen(false);
      await loadAll();
    } catch (err) {
      toast.error("Group save failed", err instanceof Error ? err.message : "Could not save group.");
    }
  };

  const handleToggleGroupMember = async (group: ContactGroupRecord, contact: ContactRecord) => {
    const isMember = contact.groups.some((g) => g.id === group.id);
    try {
      await api.post(`/groups/${group.id}/members/`, {
        add_contact_ids: isMember ? [] : [contact.id],
        remove_contact_ids: isMember ? [contact.id] : [],
      });
      toast.success(isMember ? "Removed from group" : "Added to group", `${contact.name} · ${group.name}`);
      await loadAll();
    } catch (err) {
      toast.error("Membership update failed", err instanceof Error ? err.message : "Error");
    }
  };

  const handleAddSuppression = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supPhone.trim()) return;
    try {
      await api.post("/suppressions/", {
        phone_number: supPhone.trim(),
        reason: supReason,
        notes: supNotes.trim(),
      });
      setSupPhone("");
      setSupNotes("");
      toast.success("Suppression Added", "Outbound campaigns & auto-replies to this number are now blocked.");
      await loadAll();
    } catch (err) {
      toast.error("Failed to suppress number", err instanceof Error ? err.message : "Invalid phone number.");
    }
  };

  const handleRemoveSuppression = async (id: string) => {
    try {
      await api.delete(`/suppressions/${id}/`);
      toast.info("Suppression Removed");
      await loadAll();
    } catch (err) {
      toast.error("Remove failed", err instanceof Error ? err.message : "Could not delete suppression.");
    }
  };

  const handleRunNormalizer = async () => {
    const lines = normInput
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const res = await api.post<{
        results: Array<{ input: string; normalized: string | null; valid: boolean; duplicate?: boolean; error?: string }>;
      }>("/contacts/normalize-preview/", { numbers: lines });
      setNormResults(res.results);
    } catch (err) {
      toast.error("Normalization failed", err instanceof Error ? err.message : "Request failed.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contacts, Groups & Consent Policy"
        subtitle="Manage E.164 phone records, explicit opt-in/opt-out consent, group policies, and suppression lists."
        actions={
          <>
            <button type="button" onClick={handleExportCsv} className="btn-secondary text-xs">
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setImportSummary(null);
                setConsentConfirmed(false);
                setImportOpen(true);
              }}
              className="btn-secondary text-xs"
            >
              <Upload className="w-3.5 h-3.5 text-cyan-400" />
              <span>Import CSV</span>
            </button>
            <button type="button" onClick={openCreateContact} className="btn-primary text-xs">
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add Contact</span>
            </button>
          </>
        }
      />

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
        {(
          [
            { id: "contacts", label: `Contacts (${contacts.length})` },
            { id: "groups", label: `Groups & Policies (${groups.length})` },
            { id: "suppressions", label: `Suppression List (${suppressions.length})` },
            { id: "normalizer", label: "+255 / E.164 Normalizer" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-medium border cursor-pointer ${
              tab === t.id
                ? "bg-violet-600 text-white border-violet-500"
                : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSkeleton rows={4} label="Loading contacts" />
      ) : error ? (
        <ErrorState message={error} onRetry={loadAll} />
      ) : tab === "contacts" ? (
        <div className="space-y-4">
          <div className="surface-card p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="search"
              aria-label="Search contacts"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, +255 number, email..."
              className="input-field"
            />
            <select
              aria-label="Filter by group"
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="input-field"
            >
              <option value="">All Groups</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by consent status"
              value={optFilter}
              onChange={(e) => setOptFilter(e.target.value as "" | "opted_in" | "opted_out" | "virtual")}
              className="input-field"
            >
              <option value="">All Consent States</option>
              <option value="opted_in">Opted-In Only</option>
              <option value="opted_out">Opted-Out Only</option>
              <option value="virtual">Virtual (Simulation) Contacts</option>
            </select>
          </div>

          {contacts.length === 0 ? (
            <EmptyState
              title="No contacts found"
              description="Add individual contacts or import a CSV spreadsheet with recipient consent."
              icon={Users}
              action={
                <button type="button" onClick={openCreateContact} className="btn-primary text-xs">
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Add First Contact</span>
                </button>
              }
            />
          ) : (
            <div className="surface-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-[11px] uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-elevated)]">
                      <th className="py-3 px-4">Contact</th>
                      <th className="py-3 px-4">Normalized E.164</th>
                      <th className="py-3 px-4">Groups</th>
                      <th className="py-3 px-4">Consent Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)] text-sm">
                    {contacts.map((c) => (
                      <tr key={c.id} className="hover:bg-[var(--bg-elevated)]/50">
                        <td className="py-3 px-4">
                          <div className="font-medium text-[var(--text-primary)] flex items-center gap-2">
                            <span>{c.name}</span>
                            {c.is_virtual && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400">
                                Virtual
                              </span>
                            )}
                          </div>
                          {c.email && <div className="text-xs text-[var(--text-muted)]">{c.email}</div>}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs">{c.phone_number}</td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {c.groups.map((g) => (
                              <span
                                key={g.id}
                                className="px-2 py-0.5 rounded-full text-[11px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
                              >
                                {g.name}
                              </span>
                            ))}
                            {c.groups.length === 0 && <span className="text-xs text-[var(--text-muted)]">—</span>}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {c.opt_out_status ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-rose-500/15 text-rose-400 border border-rose-500/30">
                              <ShieldBan className="w-3 h-3" />
                              <span>Opted Out</span>
                            </span>
                          ) : c.opt_in_status ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              <ShieldCheck className="w-3 h-3" />
                              <span>Opted In</span>
                            </span>
                          ) : (
                            <span className="text-xs text-[var(--text-muted)]">Unconfirmed</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              title="Preview Effective Policy"
                              onClick={() => void handleInspectPolicy(c)}
                              className="btn-secondary text-xs py-1 px-2"
                            >
                              <Eye className="w-3.5 h-3.5 text-cyan-400" />
                              <span>Policy</span>
                            </button>
                            {c.opt_out_status || !c.opt_in_status ? (
                              <button
                                type="button"
                                onClick={() => void handleOptToggle(c, "opt-in")}
                                className="btn-secondary text-xs py-1 px-2 text-emerald-400"
                              >
                                Opt-In
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handleOptToggle(c, "opt-out")}
                                className="btn-secondary text-xs py-1 px-2 text-amber-400"
                              >
                                Opt-Out
                              </button>
                            )}
                            <button
                              type="button"
                              aria-label={`Edit ${c.name}`}
                              onClick={() => openEditContact(c)}
                              className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${c.name}`}
                              onClick={() => void handleDeleteContact(c)}
                              className="p-1.5 rounded-lg hover:bg-rose-500/15 text-rose-400 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : tab === "groups" ? (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" onClick={() => openGroupModal()} className="btn-primary text-xs">
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Create Contact Group</span>
            </button>
          </div>
          {groups.length === 0 ? (
            <EmptyState
              title="No contact groups yet"
              description="Group contacts by course, department, or customer segment with shared auto-reply and quiet-hour policies."
              action={
                <button type="button" onClick={() => openGroupModal()} className="btn-primary text-xs">
                  <span>Create Group</span>
                </button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {groups.map((g) => (
                <div key={g.id} className="surface-card p-5 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: g.color || "#7C3AED" }} />
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{g.name}</h3>
                        <p className="text-xs text-[var(--text-secondary)]">{g.description || "No description"}</p>
                      </div>
                    </div>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--bg-elevated)]">
                      {g.member_count} members
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px] text-[var(--text-secondary)]">
                    <span className="px-2 py-0.5 rounded surface-elevated">
                      Outgoing: {g.allow_outgoing ? "Allowed" : "Blocked"}
                    </span>
                    <span className="px-2 py-0.5 rounded surface-elevated">
                      Auto-Reply: {g.allow_auto_reply ? "Allowed" : "Disabled"}
                    </span>
                    <span className="px-2 py-0.5 rounded surface-elevated">
                      AI Reply: {g.allow_ai_reply ? "Enabled" : "Disabled"}
                    </span>
                    <span className="px-2 py-0.5 rounded surface-elevated">Cooldown: {g.cooldown_minutes}m</span>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
                    <button
                      type="button"
                      onClick={() => setMemberModalGroup(g)}
                      className="btn-secondary text-xs py-1 px-2.5"
                    >
                      Manage Members
                    </button>
                    <button
                      type="button"
                      onClick={() => openGroupModal(g)}
                      className="btn-secondary text-xs py-1 px-2.5"
                    >
                      Edit Policy
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.delete(`/groups/${g.id}/`);
                        toast.info("Group deleted", g.name);
                        void loadAll();
                      }}
                      className="btn-secondary text-xs py-1 px-2.5 text-rose-400"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : tab === "suppressions" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <form onSubmit={handleAddSuppression} className="surface-card p-5 space-y-3.5 h-fit">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Add Number to Suppression List</h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Suppressed numbers are strictly excluded from all bulk campaigns and automated replies.
            </p>
            <div>
              <label htmlFor="sup-phone" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Phone Number
              </label>
              <input
                id="sup-phone"
                type="text"
                value={supPhone}
                onChange={(e) => setSupPhone(e.target.value)}
                placeholder="+255784400504"
                className="input-field font-mono"
                required
              />
            </div>
            <div>
              <label htmlFor="sup-reason" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Reason
              </label>
              <select
                id="sup-reason"
                value={supReason}
                onChange={(e) => setSupReason(e.target.value as SuppressionRecord["reason"])}
                className="input-field"
              >
                <option value="manual_block">Manual Block</option>
                <option value="opt_out">Recipient Opted Out</option>
                <option value="invalid_number">Invalid Destination Number</option>
                <option value="carrier_bounce">Permanent Carrier Bounce</option>
              </select>
            </div>
            <div>
              <label htmlFor="sup-notes" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Notes
              </label>
              <input
                id="sup-notes"
                type="text"
                value={supNotes}
                onChange={(e) => setSupNotes(e.target.value)}
                placeholder="Requested via phone call"
                className="input-field"
              />
            </div>
            <button type="submit" className="btn-primary w-full text-xs">
              <ShieldBan className="w-4 h-4" />
              <span>Add Suppression</span>
            </button>
          </form>

          <div className="lg:col-span-2 surface-card p-5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              Active Suppression Records ({suppressions.length})
            </h2>
            {suppressions.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No suppressed numbers recorded.</p>
            ) : (
              <div className="space-y-2">
                {suppressions.map((s) => (
                  <div key={s.id} className="surface-elevated p-3 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-mono font-semibold text-[var(--text-primary)]">{s.phone_number}</span>
                      <span className="ml-2 px-2 py-0.5 rounded bg-rose-500/15 text-rose-400">{s.reason}</span>
                      {s.notes && <p className="text-[var(--text-muted)] mt-0.5">{s.notes}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRemoveSuppression(s.id)}
                      className="btn-secondary text-xs py-1 px-2 text-rose-400"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="surface-card p-5 space-y-3.5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-cyan-400" />
              <span>Batch +255 / E.164 Normalization Preview</span>
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Paste raw phone numbers (one per line) to validate E.164 formatting and detect duplicates before
              importing.
            </p>
            <textarea
              rows={6}
              value={normInput}
              onChange={(e) => setNormInput(e.target.value)}
              className="input-field font-mono text-xs"
            />
            <button type="button" onClick={handleRunNormalizer} className="btn-primary text-xs">
              Validate & Normalize Numbers
            </button>
          </div>
          <div className="surface-card p-5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Normalization Results</h2>
            {normResults.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">Click Validate to preview normalized E.164 numbers.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {normResults.map((r, i) => (
                  <div key={i} className="surface-elevated p-2.5 text-xs flex items-center justify-between">
                    <span className="font-mono text-[var(--text-secondary)]">{r.input}</span>
                    {r.valid ? (
                      <span className="inline-flex items-center gap-1.5 font-mono text-emerald-400 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{r.normalized}</span>
                        {r.duplicate && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                            Duplicate
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-400">
                        <XCircle className="w-3.5 h-3.5" />
                        <span>{r.error || "Invalid"}</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create / Edit Contact Modal */}
      <Modal
        open={contactModalOpen}
        onClose={() => setContactModalOpen(false)}
        title={editingContact ? "Edit Contact" : "Create Contact"}
        footer={
          <>
            <button type="button" onClick={() => setContactModalOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" form="contact-form" disabled={savingContact} className="btn-primary">
              {savingContact ? "Saving..." : "Save Contact"}
            </button>
          </>
        }
      >
        <form id="contact-form" onSubmit={handleSaveContact} className="space-y-3.5">
          <div>
            <label htmlFor="contact-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Full Name
            </label>
            <input
              id="contact-name"
              type="text"
              value={cName}
              onChange={(e) => setCName(e.target.value)}
              className="input-field"
              required
            />
          </div>
          <div>
            <label htmlFor="contact-phone" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Phone Number (E.164 or local)
            </label>
            <input
              id="contact-phone"
              type="tel"
              value={cPhone}
              onChange={(e) => setCPhone(e.target.value)}
              className="input-field font-mono"
              required
            />
          </div>
          <div>
            <label htmlFor="contact-email" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Email (Optional)
            </label>
            <input
              id="contact-email"
              type="email"
              value={cEmail}
              onChange={(e) => setCEmail(e.target.value)}
              className="input-field"
            />
          </div>
          {groups.length > 0 && (
            <div>
              <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Assign Groups</span>
              <div className="flex flex-wrap gap-2">
                {groups.map((g) => {
                  const checked = cGroupIds.includes(g.id);
                  return (
                    <label key={g.id} className="inline-flex items-center gap-1.5 text-xs surface-elevated px-2.5 py-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setCGroupIds((prev) =>
                            e.target.checked ? [...prev, g.id] : prev.filter((id) => id !== g.id)
                          )
                        }
                      />
                      <span>{g.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
            <label className="surface-elevated p-2.5 flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={cOptIn} onChange={(e) => setCOptIn(e.target.checked)} />
              <span>Opted-In Consent</span>
            </label>
            <label className="surface-elevated p-2.5 flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={cAllowOutgoing}
                onChange={(e) => setCAllowOutgoing(e.target.checked)}
              />
              <span>Allow Outgoing</span>
            </label>
            <label className="surface-elevated p-2.5 flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={cIsVirtual} onChange={(e) => setCIsVirtual(e.target.checked)} />
              <span>Virtual (Sandbox)</span>
            </label>
          </div>
          <div>
            <label htmlFor="contact-notes" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Notes
            </label>
            <textarea
              id="contact-notes"
              rows={2}
              value={cNotes}
              onChange={(e) => setCNotes(e.target.value)}
              className="input-field"
            />
          </div>
        </form>
      </Modal>

      {/* CSV Import Modal with Mandatory Consent Checkbox */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import Contacts from CSV"
        subtitle="Automatically normalizes phone numbers and deduplicates in-file rows."
        footer={
          <>
            <button type="button" onClick={() => setImportOpen(false)} className="btn-secondary">
              Close
            </button>
            <button
              type="submit"
              form="csv-import-form"
              disabled={!consentConfirmed || importing}
              className="btn-primary"
            >
              {importing ? "Importing..." : "Import Contacts"}
            </button>
          </>
        }
      >
        <form id="csv-import-form" onSubmit={handleImportCsv} className="space-y-4">
          <div>
            <label htmlFor="csv-file-upload" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Upload `.csv` File or Edit CSV Text Below
            </label>
            <input
              id="csv-file-upload"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  void f.text().then((txt) => setCsvText(txt));
                }
              }}
              className="input-field text-xs mb-2"
            />
            <textarea
              aria-label="CSV content"
              rows={5}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="input-field font-mono text-xs"
              required
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={markOptedIn} onChange={(e) => setMarkOptedIn(e.target.checked)} />
              <span>Record opt-in consent for imported contacts</span>
            </label>
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={importVirtual} onChange={(e) => setImportVirtual(e.target.checked)} />
              <span>Mark as Virtual (Simulation Lab)</span>
            </label>
          </div>

          <label className="p-3.5 rounded-xl bg-violet-500/10 border border-violet-500/35 flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={consentConfirmed}
              onChange={(e) => setConsentConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-xs text-[var(--text-primary)] leading-relaxed">
              <strong>Mandatory Authorization Confirmation:</strong> I confirm that these recipients have provided
              explicit permission to receive communications from this organization and have not opted out.
            </span>
          </label>

          {importSummary && (
            <div role="status" className="surface-elevated p-3 text-xs space-y-1">
              <div className="font-semibold text-emerald-400">Import Summary</div>
              <div>
                Created: {String(importSummary.created_count)} · Updated:{" "}
                {String(importSummary.existing_updated_count)} · Duplicates skipped:{" "}
                {String(importSummary.duplicate_in_file_count)} · Invalid: {String(importSummary.invalid_count)}
              </div>
            </div>
          )}
        </form>
      </Modal>

      {/* Effective Policy Preview Modal */}
      <Modal
        open={Boolean(policyPreview)}
        onClose={() => setPolicyPreview(null)}
        title="Effective Contact Policy Resolution"
        subtitle={policyPreview ? `${policyPreview.contact_name} (${policyPreview.phone_number})` : undefined}
        footer={
          <button type="button" onClick={() => setPolicyPreview(null)} className="btn-secondary">
            Close
          </button>
        }
      >
        {policyPreview && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="surface-elevated p-3">
                <div className="text-[var(--text-muted)]">Outgoing SMS</div>
                <div className={`font-bold mt-1 ${policyPreview.can_send_outgoing ? "text-emerald-400" : "text-rose-400"}`}>
                  {policyPreview.can_send_outgoing ? "Allowed" : "Blocked"}
                </div>
              </div>
              <div className="surface-elevated p-3">
                <div className="text-[var(--text-muted)]">Auto-Reply</div>
                <div className={`font-bold mt-1 ${policyPreview.can_auto_reply ? "text-emerald-400" : "text-rose-400"}`}>
                  {policyPreview.can_auto_reply ? "Allowed" : "Blocked"}
                </div>
              </div>
              <div className="surface-elevated p-3">
                <div className="text-[var(--text-muted)]">AI Responder</div>
                <div className={`font-bold mt-1 ${policyPreview.can_ai_reply ? "text-emerald-400" : "text-amber-400"}`}>
                  {policyPreview.can_ai_reply ? "Enabled" : "Disabled"}
                </div>
              </div>
            </div>

            <div className="surface-elevated p-3.5 space-y-1.5">
              <div>
                <strong>Effective Mode:</strong> {policyPreview.effective_mode_name} (source:{" "}
                <code>{policyPreview.effective_mode_source}</code>)
              </div>
              <div>
                <strong>Cooldown:</strong> {policyPreview.effective_cooldown_minutes} min (source:{" "}
                <code>{policyPreview.cooldown_source}</code>)
              </div>
              <div>
                <strong>Quiet Hours Active Now:</strong> {policyPreview.in_quiet_hours ? "Yes" : "No"}
              </div>
            </div>

            {policyPreview.blocking_reasons.length > 0 && (
              <div className="p-3 rounded-xl bg-rose-500/12 border border-rose-500/35 text-rose-400 space-y-1">
                <div className="font-semibold">Blocking Reasons:</div>
                <ul className="list-disc pl-4">
                  {policyPreview.blocking_reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <div className="font-semibold text-[var(--text-secondary)] mb-1.5">Policy Inheritance Trace</div>
              <ul className="surface-elevated p-3 space-y-1 font-mono text-[11px]">
                {policyPreview.inheritance_trace.map((line, i) => (
                  <li key={i}>• {line}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Modal>

      {/* Group Create/Edit Modal */}
      <Modal
        open={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        title={editingGroup ? "Edit Group & Policy" : "Create Contact Group"}
        footer={
          <>
            <button type="button" onClick={() => setGroupModalOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" form="group-form" className="btn-primary">
              Save Group
            </button>
          </>
        }
      >
        <form id="group-form" onSubmit={handleSaveGroup} className="space-y-3.5">
          <div>
            <label htmlFor="grp-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Group Name
            </label>
            <input
              id="grp-name"
              type="text"
              value={gName}
              onChange={(e) => setGName(e.target.value)}
              className="input-field"
              required
            />
          </div>
          <div>
            <label htmlFor="grp-desc" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Description
            </label>
            <input
              id="grp-desc"
              type="text"
              value={gDesc}
              onChange={(e) => setGDesc(e.target.value)}
              className="input-field"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="grp-color" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Badge Color
              </label>
              <input
                id="grp-color"
                type="color"
                value={gColor}
                onChange={(e) => setGColor(e.target.value)}
                className="h-9 w-full rounded cursor-pointer"
              />
            </div>
            <div>
              <label htmlFor="grp-cooldown" className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Cooldown (minutes)
              </label>
              <input
                id="grp-cooldown"
                type="number"
                min={0}
                value={gCooldown}
                onChange={(e) => setGCooldown(Number(e.target.value))}
                className="input-field"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="surface-elevated p-2.5 flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={gAllowOut} onChange={(e) => setGAllowOut(e.target.checked)} />
              <span>Outgoing</span>
            </label>
            <label className="surface-elevated p-2.5 flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={gAllowAuto} onChange={(e) => setGAllowAuto(e.target.checked)} />
              <span>Auto-Reply</span>
            </label>
            <label className="surface-elevated p-2.5 flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={gAllowAi} onChange={(e) => setGAllowAi(e.target.checked)} />
              <span>AI Reply</span>
            </label>
          </div>
        </form>
      </Modal>

      {/* Group Members Modal */}
      <Modal
        open={Boolean(memberModalGroup)}
        onClose={() => setMemberModalGroup(null)}
        title={memberModalGroup ? `Members — ${memberModalGroup.name}` : "Manage Members"}
        footer={
          <button type="button" onClick={() => setMemberModalGroup(null)} className="btn-secondary">
            Done
          </button>
        }
      >
        {memberModalGroup && (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {contacts.map((c) => {
              const inGroup = c.groups.some((g) => g.id === memberModalGroup.id);
              return (
                <label
                  key={c.id}
                  className="surface-elevated p-2.5 flex items-center justify-between text-xs cursor-pointer"
                >
                  <div>
                    <span className="font-medium">{c.name}</span>{" "}
                    <span className="font-mono text-[var(--text-muted)]">({c.phone_number})</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={inGroup}
                    onChange={() => void handleToggleGroupMember(memberModalGroup, c)}
                  />
                </label>
              );
            })}
          </div>
        )}
      </Modal>
    </div>
  );
}
