"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase-browser";

interface Props {
  providerId: string;
  initial: {
    bio: string | null;
    credentials: string | null;
    specialty: string | null;
    years_experience: number | null;
    photo_url: string | null;
  };
}

export default function ProfileForm({ providerId, initial }: Props) {
  const [bio, setBio] = useState(initial.bio || "");
  const [credentials, setCredentials] = useState(initial.credentials || "");
  const [specialty, setSpecialty] = useState(initial.specialty || "");
  const [yearsExperience, setYearsExperience] = useState(
    initial.years_experience ? String(initial.years_experience) : ""
  );
  const [photoUrl, setPhotoUrl] = useState(initial.photo_url || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    const supabase = createBrowserSupabase();
    const { error: updateError } = await supabase
      .from("providers")
      .update({
        bio: bio.trim() || null,
        credentials: credentials.trim() || null,
        specialty: specialty.trim() || null,
        years_experience: yearsExperience ? parseInt(yearsExperience, 10) : null,
        photo_url: photoUrl.trim() || null,
      })
      .eq("id", providerId);

    if (updateError) {
      setError("Something went wrong saving. Please try again.");
    } else {
      setSaved(true);
    }
    setSaving(false);
  };

  return (
    <div className="lux-card">
      <h1 className="lux-card-title">Edit profile</h1>
      <p className="lux-card-sub">This is what patients see on the marketplace card.</p>

      <div className="lux-input-row">
        <input
          type="text"
          className="lux-input"
          placeholder="Credentials (e.g. MD, NP)"
          value={credentials}
          onChange={(e) => setCredentials(e.target.value)}
        />
        <input
          type="text"
          className="lux-input"
          placeholder="Specialty (e.g. Family Medicine)"
          value={specialty}
          onChange={(e) => setSpecialty(e.target.value)}
        />
      </div>
      <input
        type="number"
        className="lux-input"
        placeholder="Years of experience"
        value={yearsExperience}
        onChange={(e) => setYearsExperience(e.target.value)}
        min={0}
      />
      <input
        type="url"
        className="lux-input"
        placeholder="Photo URL (a real headshot works best)"
        value={photoUrl}
        onChange={(e) => setPhotoUrl(e.target.value)}
      />
      <textarea
        className="lux-textarea"
        placeholder="Short bio shown on your card"
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        rows={3}
      />

      {error && <div className="telehealth-error">{error}</div>}
      {saved && <div className="lux-callout">Saved.</div>}

      <button className="lux-btn" onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save profile"}
      </button>
    </div>
  );
}
