"use client";
import React, { useMemo, useState, useCallback, useEffect } from "react";
import axios from "axios";
import styles from "./page.module.css";

type Field = {
  name: string;
  type: string;
  label: string;
  required?: boolean;
  options?: { value: string; label: string }[];
};

type InspectMeta = {
  action: string;
  fbzx: string;
  fields: Field[];
  hiddenParams?: Record<string, string>;
  originViewUrl?: string;
};

const LOCKED_VALUES = {
  id: "20428",
  fullname: "นายอธิป เชิดศร",
  nickname: "ออมสิน",
};

type Identity = {
  key: string;
  id: string;
  fullname: string;
  nickname: string;
};

const isShortInput = (f: Field) =>
  f.type === "text" || f.type === "textarea" || !f.type || f.type === "hidden";

function pickIdentityFieldsByLabel(fields: Field[]) {
  const norm = (s: string) =>
    (s || "")
      .toLowerCase()
      .replace(/[()\[\]{}]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const isId = (lbl: string) =>
    /(id|เลข\s*ประจำตัว|รหัส\s*นักศึกษา|student\s*id)/i.test(lbl);
  const isFullname = (lbl: string) =>
    /(ชื่อ[-\s]?นามสกุล|fullname|full\s*name)/i.test(lbl);
  const isNickname = (lbl: string) => /(ชื่อเล่น|nickname)/i.test(lbl);

  let id: Field | undefined;
  let fullname: Field | undefined;
  let nickname: Field | undefined;

  for (const f of fields) {
    const lbl = norm(f.label || "");
    if (!id && isId(lbl)) {
      id = f;
      continue;
    }
    if (!fullname && isFullname(lbl)) {
      fullname = f;
      continue;
    }
    if (!nickname && isNickname(lbl)) {
      nickname = f;
      continue;
    }
  }

  if (!id || !fullname || !nickname) {
    const shortInputs = fields.filter(isShortInput);
    id ??= shortInputs[0];
    fullname ??= shortInputs[1];
    nickname ??= shortInputs[2];
  }

  return { id, fullname, nickname } as {
    id?: Field;
    fullname?: Field;
    nickname?: Field;
  };
}

function normalizeLabel(raw: string): string {
  let s = (raw || "").toLowerCase();
  s = s.replace(/^\s*\d+[\)\.]\s*/, "");
  s = s.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-");
  s = s.replace(/\([^)]*\)/g, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/[\s\-\_]/g, "");
  s = s.replace(/[^a-z0-9\u0E00-\u0E7F]/g, "");
  return s;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<InspectMeta | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");

  const [identities, setIdentities] = useState<Identity[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [inputId, setInputId] = useState("");
  const [inputFullname, setInputFullname] = useState("");
  const [inputNickname, setInputNickname] = useState("");

  const [manualMap, setManualMap] = useState<{
    id?: string;
    fullname?: string;
    nickname?: string;
  }>({});

  useEffect(() => {
    setIdentities([
      {
        key: "seed-0",
        id: LOCKED_VALUES.id,
        fullname: LOCKED_VALUES.fullname,
        nickname: LOCKED_VALUES.nickname,
      },
    ]);
    setSelectedKey("seed-0");
  }, []);

  const AX = useMemo(() => axios.create({ timeout: 12000 }), []);

  const load = useCallback(async () => {
    setStatus("");
    setMeta(null);
    setManualMap({});
    const { data } = await AX.get<InspectMeta>("/api/forms/inspect", {
      params: { url },
    });
    setMeta(data);

    const next: Record<string, any> = {};
    data.fields.forEach((f) => (next[f.name] = ""));
    setValues(next);
  }, [url, AX]);

  const chosenFields = useMemo(
    () => (meta ? pickIdentityFieldsByLabel(meta.fields) : {}),
    [meta]
  );

  const identityNames = useMemo(() => {
    const sset = new Set<string>();
    const c = chosenFields as {
      id?: Field;
      fullname?: Field;
      nickname?: Field;
    };
    if (c.id?.name) sset.add(c.id.name);
    if (c.fullname?.name) sset.add(c.fullname.name);
    if (c.nickname?.name) sset.add(c.nickname.name);
    if (manualMap.id) sset.add(manualMap.id);
    if (manualMap.fullname) sset.add(manualMap.fullname);
    if (manualMap.nickname) sset.add(manualMap.nickname);
    return sset;
  }, [chosenFields, manualMap]);

  const onChange = (name: string, v: any) =>
    setValues((st) => ({ ...st, [name]: v }));

  const addIdentity = () => {
    const id = inputId.trim();
    const fullname = inputFullname.trim();
    const nickname = inputNickname.trim();

    if (!id || !fullname || !nickname) {
      setStatus("กรุณากรอก ID, ชื่อ-นามสกุล, และชื่อเล่นให้ครบ");
      return;
    }
    const key = `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const item: Identity = { key, id, fullname, nickname };
    setIdentities((prev) => [item, ...prev]);
    setSelectedKey(key);
    setInputId("");
    setInputFullname("");
    setInputNickname("");
    setStatus("");
  };

  const removeIdentity = (key: string) => {
    setIdentities((prev) => prev.filter((x) => x.key !== key));
    if (selectedKey === key) {
      const next = identities.filter((x) => x.key !== key);
      setSelectedKey(next[0]?.key ?? null);
    }
  };

  const selectIdentity = (key: string) => setSelectedKey(key);

  const getSelectedIdentity = (): Identity | null => {
    if (!identities.length) return null;
    if (selectedKey)
      return identities.find((x) => x.key === selectedKey) ?? null;
    return identities[0];
  };

  const onSubmit = useCallback(async () => {
    if (!meta) return;
    setSubmitting(true);
    setStatus("");
    try {
      const forceValues = { ...values };

      const selected = getSelectedIdentity();

      const idName =
        manualMap.id || (chosenFields as any).id?.name || undefined;
      const fullnameName =
        manualMap.fullname || (chosenFields as any).fullname?.name || undefined;
      const nicknameName =
        manualMap.nickname || (chosenFields as any).nickname?.name || undefined;

      if (selected) {
        if (idName) forceValues[idName] = selected.id;
        if (fullnameName) forceValues[fullnameName] = selected.fullname;
        if (nicknameName) forceValues[nicknameName] = selected.nickname;
      } else {
        if (idName) forceValues[idName] = LOCKED_VALUES.id;
        if (fullnameName) forceValues[fullnameName] = LOCKED_VALUES.fullname;
        if (nicknameName) forceValues[nicknameName] = LOCKED_VALUES.nickname;
      }

      const missing: string[] = [];
      meta.fields.forEach((f) => {
        const n = normalizeLabel(f.label || "");
        const looksDate =
          n.includes(normalizeLabel("วันที่ต้องการลงงาน")) ||
          /workdate/.test(n);
        const looksPos =
          n.includes(normalizeLabel("ตำแหน่ง")) || /position/.test(n);
        if ((looksDate || looksPos) && !forceValues[f.name]) {
          missing.push(f.label);
        }
      });
      if (missing.length) {
        setSubmitting(false);
        setStatus(`กรุณาเลือก: ${missing.join(", ")}`);
        return;
      }

      const { data } = await AX.post("/api/forms/submit", {
        action: meta.action,
        fbzx: meta.fbzx,
        answers: forceValues,
        hiddenParams: (meta as any).hiddenParams || {},
        originViewUrl: (meta as any).originViewUrl || url,
      });

      setStatus(
        data.success ? "ส่งคำตอบสำเร็จ" : `ไม่สำเร็จ (status ${data.status})`
      );
    } catch (e: any) {
      setStatus(`เกิดข้อผิดพลาด: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  }, [meta, url, values, chosenFields, AX, identities, selectedKey, manualMap]);

  const shortEntryFields = useMemo(
    () => (meta ? meta.fields.filter(isShortInput) : []),
    [meta]
  );

  return (
    <main className={styles.container}>
      <div className={styles.urlRow}>
        <input
          className={styles.input}
          placeholder="วางลิงก์ Google Form"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button className={styles.button} disabled={!url} onClick={load}>
          Load
        </button>
      </div>

      <div className={styles.card}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionTitle}>ข้อมูลรายชื่อ</div>
            <div className={styles.sectionSub}>
              เพิ่ม/เลือกข้อมูลเพื่อใช้กรอกอัตโนมัติ
            </div>
          </div>
          <div className={styles.pill}>
            ทั้งหมด{" "}
            <span className={styles.pillCount}>{identities.length}</span>
          </div>
        </div>

        <div className={styles.identityGrid}>
          <input
            className={styles.text}
            placeholder="ID"
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
          />
          <input
            className={styles.text}
            placeholder="ชื่อ-นามสกุล"
            value={inputFullname}
            onChange={(e) => setInputFullname(e.target.value)}
          />
          <input
            className={styles.text}
            placeholder="ชื่อเล่น"
            value={inputNickname}
            onChange={(e) => setInputNickname(e.target.value)}
          />
          <button
            className={`${styles.btn} ${styles.btnSuccess}`}
            onClick={addIdentity}
          >
            เพิ่มเข้าลิสต์
          </button>
        </div>

        <div className={styles.divider} />

        <ol className={styles.identityList}>
          {identities.map((it, idx) => {
            const selected = it.key === selectedKey;
            return (
              <li
                key={it.key}
                className={`${styles.identityItem} ${
                  selected ? styles.identityItemActive : ""
                }`}
              >
                <div className={styles.identityLeft}>
                  <span className={styles.identityBadge}>{idx + 1}</span>
                  <div className={styles.identityTextCol}>
                    <div className={styles.identityLine}>
                      <b>ID</b> {it.id}
                      <span className={styles.dot}>•</span>
                      <b>ชื่อ-นามสกุล</b> {it.fullname}
                      <span className={styles.dot}>•</span>
                      <b>ชื่อเล่น</b> {it.nickname}
                    </div>
                    <div className={styles.identityHint}>
                      {selected
                        ? "กำลังใช้ค่านี้ในการส่ง"
                        : "กดเลือกเพื่อใช้ค่านี้ตอน Submit"}
                    </div>
                  </div>
                </div>
                <div className={styles.identityActions}>
                  <button
                    className={`${styles.btn} ${
                      selected ? styles.btnGhostPrimary : styles.btnPrimary
                    }`}
                    onClick={() => selectIdentity(it.key)}
                    aria-pressed={selected}
                  >
                    {selected ? "ใช้งาน" : "ไม่ใช้งาน"}
                  </button>
                  <button
                    className={`${styles.btn} ${styles.btnDangerOutline}`}
                    onClick={() => removeIdentity(it.key)}
                  >
                    ลบ
                  </button>
                </div>
              </li>
            );
          })}
          {!identities.length && (
            <div className={styles.emptyHint}>ยังไม่มีรายการที่บันทึก</div>
          )}
        </ol>
      </div>

      {/* เมื่อโหลดฟอร์มแล้ว */}
      {meta && (
        <>
          {/* --- NEW: Fallback Manual Mapping Section --- */}
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>
                  จับคู่ช่อง ID/ชื่อ/ชื่อเล่น
                </div>
                <div className={styles.sectionSub}>
                  ถ้าระบบจับอัตโนมัติไม่ตรง ให้เลือกชื่อช่องเอง
                  (เลือกเฉพาะช่องสั้น)
                </div>
              </div>
            </div>

            <div className={styles.identityGrid}>
              <div className={styles.field}>
                <div className={styles.fieldLabelWrap}>
                  <span className={styles.fieldLabel}>ช่องสำหรับ ID</span>
                </div>
                <select
                  className={styles.select}
                  value={manualMap.id || ""}
                  onChange={(e) =>
                    setManualMap((m) => ({
                      ...m,
                      id: e.target.value || undefined,
                    }))
                  }
                >
                  <option value="">(อัตโนมัติ)</option>
                  {shortEntryFields.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.label || f.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.field}>
                <div className={styles.fieldLabelWrap}>
                  <span className={styles.fieldLabel}>
                    ช่องสำหรับ ชื่อ-นามสกุล
                  </span>
                </div>
                <select
                  className={styles.select}
                  value={manualMap.fullname || ""}
                  onChange={(e) =>
                    setManualMap((m) => ({
                      ...m,
                      fullname: e.target.value || undefined,
                    }))
                  }
                >
                  <option value="">(อัตโนมัติ)</option>
                  {shortEntryFields.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.label || f.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.field}>
                <div className={styles.fieldLabelWrap}>
                  <span className={styles.fieldLabel}>ช่องสำหรับ ชื่อเล่น</span>
                </div>
                <select
                  className={styles.select}
                  value={manualMap.nickname || ""}
                  onChange={(e) =>
                    setManualMap((m) => ({
                      ...m,
                      nickname: e.target.value || undefined,
                    }))
                  }
                >
                  <option value="">(อัตโนมัติ)</option>
                  {shortEntryFields.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.label || f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          {/* --- END Manual Mapping Section --- */}

          <div className={styles.card}>
            {meta.fields.map((f, i) => {
              const isIdentity = identityNames.has(f.name);
              if (isIdentity) return null;
              if (f.type === "hidden") return null;

              const labelEl = (
                <div className={styles.fieldLabelWrap}>
                  <span className={styles.fieldLabel}>{f.label}</span>
                  {f.required ? (
                    <span className={styles.required}></span>
                  ) : null}
                </div>
              );

              if (f.type === "select") {
                return (
                  <div key={i} className={styles.field}>
                    {labelEl}
                    <select
                      className={styles.select}
                      value={values[f.name] ?? ""}
                      onChange={(e) => onChange(f.name, e.target.value)}
                    >
                      <option value="">-- เลือก --</option>
                      {f.options?.map((op, idx) => (
                        <option key={idx} value={op.value}>
                          {op.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }

              if (f.type === "radio" && f.options?.length) {
                return (
                  <div key={i} className={styles.field}>
                    {labelEl}
                    <div className={styles.radioGroup}>
                      {f.options.map((op, idx) => (
                        <label key={idx} className={styles.radioItem}>
                          <input
                            type="radio"
                            name={f.name}
                            value={op.value}
                            checked={values[f.name] === op.value}
                            onChange={() => onChange(f.name, op.value)}
                          />
                          {op.label}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              }

              if (f.type === "textarea") {
                return (
                  <div key={i} className={styles.field}>
                    {labelEl}
                    <textarea
                      className={styles.textarea}
                      value={values[f.name] ?? ""}
                      onChange={(e) => onChange(f.name, e.target.value)}
                      rows={3}
                    />
                  </div>
                );
              }

              return (
                <div key={i} className={styles.field}>
                  {labelEl}
                  <input
                    className={styles.text}
                    type="text"
                    value={values[f.name] ?? ""}
                    onChange={(e) => onChange(f.name, e.target.value)}
                  />
                </div>
              );
            })}

            <div className={styles.actions}>
              <button
                className={styles.submit}
                onClick={onSubmit}
                disabled={submitting}
              >
                {submitting ? "กำลังส่ง…" : "Submit"}
              </button>
              {!!status && <div className={styles.status}>{status}</div>}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
