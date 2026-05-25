"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiGet, getUserId, setUserId } from "../../lib/api/client";
import { loadProfile, saveProfile, type UserProfile } from "../../lib/userScope";

type MeResponse = {
  user_id?: string;
  profile_source?: string;
};

type InterestsResponse = {
  topics: string[];
};

export default function ProfilePage() {
  const [userId, setUserIdState] = useState("");
  const [profile, setProfileState] = useState<UserProfile>(loadProfile());
  const [topics, setTopics] = useState<string[]>([]);
  const [backendSource, setBackendSource] = useState("local");
  const [savedMessage, setSavedMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setError(null);
      try {
        const [me, interests] = await Promise.all([
          apiGet<MeResponse>("/api/user/me"),
          apiGet<InterestsResponse>("/api/user/interests")
        ]);
        if (!alive) {
          return;
        }
        if (me.user_id) {
          setUserIdState(me.user_id);
        } else {
          setUserIdState(getUserId());
        }
        setBackendSource(me.profile_source ?? "local");
        setTopics(interests.topics ?? []);
      } catch (cause) {
        if (alive) {
          setUserIdState(getUserId());
          setError(cause instanceof Error ? cause.message : "Profile bootstrap failed");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextUserId = userId.trim() || "demo-user";
    setUserId(nextUserId);
    document.cookie = `sp-user-id=${encodeURIComponent(nextUserId)}; path=/; max-age=31536000; samesite=lax`;
    saveProfile(profile);
    setSavedMessage("Profile saved locally. User scope cookie updated for middleware forwarding.");
  };

  return (
    <main className="page-shell column">
      <header>
        <h1 style={{ margin: "0 0 6px" }}>Profile</h1>
        <p className="muted-small">
          Backend scope source: <code>{backendSource}</code>. Interests loaded from <code>/api/user/interests</code>.
        </p>
      </header>
      <section className="section-card column">
        <strong>Active interests</strong>
        <p className="muted-small">{topics.length > 0 ? topics.join(", ") : "No topics configured yet."}</p>
      </section>
      <section className="section-card column">
        <form onSubmit={onSubmit} className="column">
          <label className="column">
            <span>User id (x-user-id)</span>
            <input value={userId} onChange={(event) => setUserIdState(event.target.value)} />
          </label>
          <label className="column">
            <span>Display name</span>
            <input
              value={profile.displayName}
              onChange={(event) => setProfileState({ ...profile, displayName: event.target.value })}
            />
          </label>
          <label className="column">
            <span>Email</span>
            <input value={profile.email} onChange={(event) => setProfileState({ ...profile, email: event.target.value })} />
          </label>
          <label className="column">
            <span>Affiliation</span>
            <input
              value={profile.affiliation}
              onChange={(event) => setProfileState({ ...profile, affiliation: event.target.value })}
            />
          </label>
          <label className="column">
            <span>Role</span>
            <input value={profile.role} onChange={(event) => setProfileState({ ...profile, role: event.target.value })} />
          </label>
          <button type="submit">Save profile</button>
        </form>
        {savedMessage ? <p className="muted-small">{savedMessage}</p> : null}
        {error ? <p className="muted-small">Error: {error}</p> : null}
      </section>
    </main>
  );
}
