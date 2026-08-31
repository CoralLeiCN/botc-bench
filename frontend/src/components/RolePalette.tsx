import { RotateCcw, Search, SlidersHorizontal, Sparkle } from "lucide-react";
import { useMemo, useState } from "react";
import {
  allRoles,
  assignedCounts,
  setupModifierRoleIds,
  suggestedComposition,
  TEAM_LABELS,
} from "../game";
import type { Composition, GameDraft, Role, Script, Team } from "../types";

interface RolePaletteProps {
  script: Script;
  game: GameDraft;
  selectedRoleId: string | null;
  onSelectRole: (roleId: string | null) => void;
  onCompositionChange: (composition: Composition) => void;
  onResetComposition: () => void;
}

const coreTeams: Team[] = ["townsfolk", "outsider", "minion", "demon"];
const roleTeams: Team[] = [...coreTeams, "traveller"];

export function RolePalette({
  script,
  game,
  selectedRoleId,
  onSelectRole,
  onCompositionChange,
  onResetComposition,
}: RolePaletteProps) {
  const [query, setQuery] = useState("");
  const availableRoles = allRoles(script);
  const assigned = assignedCounts(game.seats, availableRoles);
  const baseComposition = suggestedComposition(game.player_count);
  const modifierIds = setupModifierRoleIds(game.seats.map((seat) => seat.role_id));
  const activeSetupRoles = availableRoles.filter(
    (role) => role.setup && game.seats.some((seat) => seat.role_id === role.id),
  );
  const roleUse = useMemo(() => {
    const counts = new Map<string, number>();
    for (const seat of game.seats) {
      if (seat.role_id) counts.set(seat.role_id, (counts.get(seat.role_id) ?? 0) + 1);
    }
    return counts;
  }, [game.seats]);
  const normalized = query.trim().toLowerCase();

  const changeComposition = (key: keyof Omit<Composition, "manual">, value: number) => {
    onCompositionChange({
      ...game.composition,
      [key]: Math.max(0, Math.min(key === "traveller" ? 5 : 20, value || 0)),
      manual: true,
    });
  };

  return (
    <aside className="left-panel panel-shell">
      <section className="composition-editor">
        <div className="panel-title-row">
          <div>
            <span className="eyebrow">SETUP</span>
            <h2>角色配比</h2>
          </div>
          <button type="button" className="ghost-icon" onClick={onResetComposition} title="恢复建议配比">
            <RotateCcw size={14} />
          </button>
        </div>
        <div className="composition-grid">
          {coreTeams.map((team) => (
            <label key={team} className={`composition-input ${team}`}>
              <span>{TEAM_LABELS[team]}</span>
              <input
                type="number"
                min={0}
                max={20}
                value={game.composition[team]}
                onChange={(event) => changeComposition(team, Number(event.target.value))}
              />
              <small>已配 {assigned[team]}</small>
            </label>
          ))}
          <label className="composition-input traveller">
            <span>旅行者</span>
            <input
              type="number"
              min={0}
              max={5}
              value={game.composition.traveller}
              onChange={(event) => changeComposition("traveller", Number(event.target.value))}
            />
            <small>15 人以上</small>
          </label>
        </div>
        <div className="composition-formula">
          <span>
            基准 {baseComposition.townsfolk}/{baseComposition.outsider}/{baseComposition.minion}/
            {baseComposition.demon}
          </span>
          {activeSetupRoles.map((role) => (
            <i key={role.id} className={modifierIds.includes(role.id) ? "applied" : "review"}>
              {role.name.zh_hans} {role.setup_effect.zh_hans ?? "需说书人裁定"}
            </i>
          ))}
        </div>
        {game.composition.manual && (
          <p className="inline-note">
            <SlidersHorizontal size={12} /> 使用说书人手动配比
          </p>
        )}
      </section>

      <section className="role-library">
        <div className="panel-title-row role-heading">
          <div>
            <span className="eyebrow">SCRIPT ROSTER</span>
            <h2>角色库</h2>
          </div>
          <span className="count-badge">{script.roles.length}</span>
        </div>
        <label className="search-box">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索中英文角色…"
          />
        </label>
        {selectedRoleId && (
          <button type="button" className="clear-selection" onClick={() => onSelectRole(null)}>
            已选角色，点击座位分配 · 取消
          </button>
        )}
        <div className="role-groups">
          {roleTeams.map((team) => {
            const roles = availableRoles.filter(
              (role) =>
                role.team === team &&
                (!normalized ||
                  role.name.zh_hans?.toLowerCase().includes(normalized) ||
                  role.name.en?.toLowerCase().includes(normalized)),
            );
            if (!roles.length) return null;
            return (
              <section className="role-group" key={team}>
                <div className={`team-heading ${team}`}>
                  <span>{TEAM_LABELS[team]}</span>
                  <small>{roles.length}</small>
                </div>
                {roles.map((role) => (
                  <RoleRow
                    key={role.id}
                    role={role}
                    selected={role.id === selectedRoleId}
                    useCount={roleUse.get(role.id) ?? 0}
                    onSelect={() => onSelectRole(role.id === selectedRoleId ? null : role.id)}
                  />
                ))}
              </section>
            );
          })}
        </div>
      </section>
    </aside>
  );
}

function RoleRow({
  role,
  selected,
  useCount,
  onSelect,
}: {
  role: Role;
  selected: boolean;
  useCount: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`role-row ${role.team} ${selected ? "selected" : ""}`}
      onClick={onSelect}
      title={`${role.ability.zh_hans}\n${role.ability.en}`}
    >
      <span className="role-sigil" aria-hidden="true">
        {role.name.zh_hans?.slice(0, 1)}
      </span>
      <span className="role-name">
        <strong>{role.name.zh_hans}</strong>
        <small>{role.name.en}</small>
      </span>
      {role.setup && <Sparkle size={13} className="setup-star" aria-label="影响配置" />}
      {useCount > 0 && <span className="use-count">×{useCount}</span>}
    </button>
  );
}
