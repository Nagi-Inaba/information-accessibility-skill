import { isDeepStrictEqual } from "node:util";
import { compareInstants } from "./date-time.mjs";
import { evidenceBindingErrors } from "./run-evidence.mjs";
import { verifyEvidenceReference } from "./evidence-reference.mjs";

const type = "participant-usability-observation";
const directIdentifier = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+?\d[\d\s().-]{8,}\d))/iu;

export function participantArtifacts(envelopesById) {
  return [...envelopesById.values()].map((entry) => entry?.envelope ?? entry)
    .filter((artifact) => artifact?.artifact_type === type)
    .sort((a, b) => String(a.artifact_id).localeCompare(String(b.artifact_id), "en"));
}

export function validateParticipantBindings(envelopesById, errors) {
  if (errors.length) return;
  const seenSessions = new Set();
  const themeLabels = new Map();
  for (const artifact of participantArtifacts(envelopesById)) {
    const payload = artifact.payload;
    if (!payload || !Array.isArray(payload.source_artifact_ids) || !Array.isArray(artifact.inputs)) {
      errors.push(`Invalid participant observation envelope: ${String(artifact.artifact_id)}.`);
      continue;
    }
    if (artifact.producer?.role_id !== "declared_participant_facilitator") {
      errors.push(`Participant observation ${artifact.artifact_id} requires a declared facilitator.`);
    }
    const inputIds = artifact.inputs.map((input) => input?.artifact_id).sort();
    if (!isDeepStrictEqual([...payload.source_artifact_ids].sort(), inputIds)) {
      errors.push(`Participant observation ${artifact.artifact_id}: source_artifact_ids must match registered inputs.`);
    }
    const sessionKey = [payload.participant_id, payload.task_id, payload.session_at].join("/");
    if (seenSessions.has(sessionKey)) errors.push(`Duplicate participant task session: ${sessionKey}.`);
    seenSessions.add(sessionKey);
    if (compareInstants(payload.session_at, artifact.created_at) > 0) {
      errors.push(`Participant observation ${artifact.artifact_id}: session follows artifact creation.`);
    }
    const consent = payload.consent ?? {};
    if (consent.participation !== true) errors.push(`Participant observation ${artifact.artifact_id}: participation consent is required.`);
    if (consent.quote_publication && !consent.quote_capture) errors.push("Quote publication cannot exceed quote capture consent.");
    if (consent.recording_publication && (!consent.recording_capture || !consent.recording_collected)) {
      errors.push("Recording publication requires capture consent and a recorded source.");
    }
    if (consent.recording_collected && !consent.recording_capture) errors.push("Recording was collected without capture consent.");
    if (payload.observations?.some((item) => item.kind === "quote") && !consent.quote_capture) {
      errors.push("Quotation was recorded without quote capture consent.");
    }
    if (consent.retention_until < new Date(payload.session_at).toISOString().slice(0, 10)) {
      errors.push("Retention date precedes the participant session.");
    }
    for (const value of [payload.journey, payload.environment, ...(payload.observations ?? []).map((item) => item.text),
      ...(payload.themes ?? []).map((item) => item.label)]) {
      if (directIdentifier.test(value ?? "")) errors.push(`Participant observation ${artifact.artifact_id}: direct contact identifier in free text.`);
    }
    const localThemes = new Set();
    for (const theme of payload.themes ?? []) {
      if (localThemes.has(theme.id)) errors.push(`Duplicate theme in participant task: ${theme.id}.`);
      localThemes.add(theme.id);
      if (themeLabels.has(theme.id) && themeLabels.get(theme.id) !== theme.label) {
        errors.push(`Conflicting theme label: ${theme.id}.`);
      }
      themeLabels.set(theme.id, theme.label);
    }
    const linked = artifact.inputs.map((input) => envelopesById.get(input.artifact_id)?.envelope ?? envelopesById.get(input.artifact_id))
      .filter(Boolean);
    const findings = new Set(linked.flatMap((source) => [
      ...(source.payload?.reviews ?? []).flatMap((review) => (review.findings ?? (review.finding ? [review.finding] : [])).map((item) => item.id)),
      ...(source.payload?.findings ?? []).map((item) => item.finding_id)
    ]));
    const remediations = new Set(linked.flatMap((source) => (source.payload?.items ?? []).map((item) => item.remediation_id)));
    for (const id of payload.related_finding_ids ?? []) if (!findings.has(id)) errors.push(`Unbound participant finding: ${id}.`);
    for (const id of payload.related_remediation_ids ?? []) if (!remediations.has(id)) errors.push(`Unbound participant remediation: ${id}.`);
  }
}

export function collectParticipantEvidence(run, artifacts, readEvidence) {
  const errors = [], snapshots = new Map();
  for (const artifact of artifacts.filter((item) => item?.artifact_type === type)) {
    const seen = new Set();
    for (const reference of artifact.payload?.evidence_refs ?? []) {
      const label = `participant observation ${artifact.artifact_id}`;
      if (!["other", "screenshot"].includes(reference.evidence_type)) {
        errors.push(`${label}: only saved document or screenshot evidence is supported.`);
        continue;
      }
      errors.push(...evidenceBindingErrors(reference, run).map((error) => `${label}: ${error}`));
      if (seen.has(reference.path)) errors.push(`${label}: duplicate evidence path ${reference.path}.`);
      seen.add(reference.path);
      if (compareInstants(reference.captured_at, artifact.created_at) > 0) {
        errors.push(`${label}: evidence capture follows artifact creation.`);
      }
      try {
        const snapshot = snapshots.get(reference.path) ?? readEvidence?.(reference.path);
        if (!snapshot || !Buffer.isBuffer(snapshot.bytes)) throw new Error("Saved evidence bytes are required.");
        verifyEvidenceReference(reference, snapshot.bytes);
        if (snapshot.sha256 !== reference.sha256) throw new Error("Evidence snapshot hash mismatch.");
        snapshots.set(reference.path, snapshot);
      } catch (error) { errors.push(`${label}: ${error.message}`); }
    }
  }
  return { errors, snapshots };
}

export function summarizeParticipantObservations(envelopesById, { visibility = "internal", asOf = new Date().toISOString().slice(0, 10) } = {}) {
  const records = participantArtifacts(envelopesById);
  if (records.length === 0) return null;
  const eligible = visibility === "public" ? records.filter((item) =>
    item.payload.consent.public_aggregate && item.payload.consent.redaction_status === "verified"
    && item.payload.consent.retention_until >= asOf) : records;
  const byTheme = new Map();
  for (const artifact of eligible) {
    for (const theme of artifact.payload.themes) {
      const current = byTheme.get(theme.id) ?? { id: theme.id, label: theme.label, participants: new Set() };
      current.participants.add(artifact.payload.participant_id);
      byTheme.set(theme.id, current);
    }
  }
  const themes = [...byTheme.values()].filter((item) => visibility !== "public" || item.participants.size >= 2)
    .map((item) => ({ id: item.id, label: item.label, participant_count: item.participants.size }))
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
  const count = new Set(eligible.map((item) => item.payload.participant_id)).size;
  return { participant_count: visibility === "public" && count < 2 ? null : count, themes,
    notice: "Task observations are usability findings, not WCAG/JIS conformance outcomes." };
}
