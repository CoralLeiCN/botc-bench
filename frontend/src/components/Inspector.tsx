import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  CircleDot,
  Plus,
  Skull,
  Trash2,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { allRoles, marker, TEAM_LABELS } from "../game";
import type { GameDraft, MarkerType, Script, Seat, Team } from "../types";

interface InspectorProps {
  game: GameDraft;
  script: Script;
  seat: Seat | null;
  onSeatChange: (seat: Seat) => void;
  onMoveSeat: (direction: -1 | 1) => void;
  onGameMetaChange: (patch: Partial<Pick<GameDraft, "phase" | "day_number" | "notes">>) => void;
}

const teams: Team[] = ["townsfolk", "outsider", "minion", "demon", "traveller"];
const markerPresets: Array<{ type: MarkerType; label: string }> = [
  { type: "drunk", label: "醉酒" },
  { type: "poisoned", label: "中毒" },
  { type: "protected", label: "保护" },
  { type: "ability_used", label: "能力已用" },
  { type: "red_herring", label: "红鲱鱼" },
  { type: "mad", label: "疯狂" },
];

export function Inspector({
  game,
  script,
  seat,
  onSeatChange,
  onMoveSeat,
  onGameMetaChange,
}: InspectorProps) {
  const [customMarker, setCustomMarker] = useState("");
  const availableRoles = allRoles(script);
  const role = seat?.role_id ? availableRoles.find((item) => item.id === seat.role_id) : undefined;

  const toggleMarker = (type: MarkerType, label: string) => {
    if (!seat) return;
    const existing = seat.markers.find((item) => item.type === type);
    onSeatChange({
      ...seat,
      markers: existing
        ? seat.markers.filter((item) => item.id !== existing.id)
        : [...seat.markers, marker(type, label)],
    });
  };

  const updateMarker = (markerId: string, patch: Partial<Seat["markers"][number]>) => {
    if (!seat) return;
    onSeatChange({
      ...seat,
      markers: seat.markers.map((item) => (item.id === markerId ? { ...item, ...patch } : item)),
    });
  };

  const addCustom = () => {
    const label = customMarker.trim();
    if (!seat || !label) return;
    onSeatChange({ ...seat, markers: [...seat.markers, marker("custom", label)] });
    setCustomMarker("");
  };

  return (
    <section className="inspector-section">
      <div className="panel-title-row inspector-title">
        <div>
          <span className="eyebrow">INSPECTOR</span>
          <h2>{seat ? `${seat.position} 号玩家` : "玩家检查器"}</h2>
        </div>
        {seat && (
          <div className="seat-move-buttons">
            <button type="button" onClick={() => onMoveSeat(-1)} title="逆时针移动">
              <ArrowLeft size={14} />
            </button>
            <button type="button" onClick={() => onMoveSeat(1)} title="顺时针移动">
              <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>

      {!seat ? (
        <div className="empty-state">
          <CircleDot size={24} />
          <p>点击魔典中的座位开始编辑。</p>
        </div>
      ) : (
        <div className="inspector-form">
          <div className="field-row two-columns">
            <label>
              <span>玩家名</span>
              <input
                value={seat.player_name}
                onChange={(event) => onSeatChange({ ...seat, player_name: event.target.value })}
                maxLength={80}
              />
            </label>
            <label>
              <span>阵营</span>
              <select
                value={seat.alignment}
                onChange={(event) =>
                  onSeatChange({ ...seat, alignment: event.target.value as Seat["alignment"] })
                }
              >
                <option value="unknown">未知</option>
                <option value="good">善良</option>
                <option value="evil">邪恶</option>
              </select>
            </label>
          </div>

          <div className="field-row role-select-row">
            <label>
              <span>真实角色</span>
              <select
                value={seat.role_id ?? ""}
                onChange={(event) => onSeatChange({ ...seat, role_id: event.target.value || null })}
              >
                <option value="">未分配</option>
                {teams.map((team) => (
                  <optgroup key={team} label={TEAM_LABELS[team]}>
                    {availableRoles
                      .filter((item) => item.team === team)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name.zh_hans} · {item.name.en}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={`life-toggle ${seat.alive ? "alive" : "dead"}`}
              onClick={() => onSeatChange({ ...seat, alive: !seat.alive })}
            >
              {seat.alive ? <UserRound size={15} /> : <Skull size={15} />}
              {seat.alive ? "存活" : "死亡"}
            </button>
          </div>

          {role && (
            <article className={`ability-card ${role.team}`}>
              <div>
                <BookOpenText size={14} />
                <strong>{role.name.zh_hans}</strong>
                <small>{role.name.en}</small>
              </div>
              <p>{role.ability.zh_hans}</p>
              <p lang="en">{role.ability.en}</p>
              {role.setup_effect.zh_hans && (
                <mark>配置影响：{role.setup_effect.zh_hans}</mark>
              )}
            </article>
          )}

          <fieldset className="marker-fieldset">
            <legend>状态与提醒标记</legend>
            <div className="marker-presets">
              {markerPresets.map((preset) => {
                const active = seat.markers.some((item) => item.type === preset.type);
                return (
                  <button
                    type="button"
                    key={preset.type}
                    className={active ? "active" : ""}
                    onClick={() => toggleMarker(preset.type, preset.label)}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <div className="custom-marker-input">
              <input
                value={customMarker}
                onChange={(event) => setCustomMarker(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCustom();
                  }
                }}
                placeholder="自定义标记"
                maxLength={80}
              />
              <button type="button" onClick={addCustom} disabled={!customMarker.trim()}>
                <Plus size={14} />
              </button>
            </div>
            {seat.markers.length > 0 && (
              <div className="marker-editor-list">
                {seat.markers.map((item) => (
                  <details key={item.id} className="marker-editor">
                    <summary>
                      <span>{item.label}</span>
                      <small>{item.source_role_id ? "有来源" : "通用"}</small>
                    </summary>
                    <div className="marker-editor-fields">
                      <label>
                        <span>标记名称</span>
                        <input
                          value={item.label}
                          maxLength={80}
                          onChange={(event) => updateMarker(item.id, { label: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>来源角色</span>
                        <select
                          value={item.source_role_id ?? ""}
                          onChange={(event) =>
                            updateMarker(item.id, { source_role_id: event.target.value || null })
                          }
                        >
                          <option value="">通用 / 未指定</option>
                          {availableRoles.map((sourceRole) => (
                            <option key={sourceRole.id} value={sourceRole.id}>
                              {sourceRole.name.zh_hans}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>持续到</span>
                        <input
                          value={item.expires ?? ""}
                          maxLength={120}
                          placeholder="如：下个黄昏"
                          onChange={(event) =>
                            updateMarker(item.id, { expires: event.target.value || null })
                          }
                        />
                      </label>
                      <label className="marker-note-field">
                        <span>备注</span>
                        <input
                          value={item.note}
                          maxLength={500}
                          onChange={(event) => updateMarker(item.id, { note: event.target.value })}
                        />
                      </label>
                      <button
                        type="button"
                        className="delete-marker"
                        onClick={() =>
                          onSeatChange({
                            ...seat,
                            markers: seat.markers.filter(
                              (markerItem) => markerItem.id !== item.id,
                            ),
                          })
                        }
                      >
                        <Trash2 size={11} /> 删除
                      </button>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </fieldset>

          <label className="notes-field">
            <span>玩家备注</span>
            <textarea
              value={seat.notes}
              onChange={(event) => onSeatChange({ ...seat, notes: event.target.value })}
              rows={2}
              maxLength={2000}
              placeholder="私聊、已知信息、说书人提醒…"
            />
          </label>
        </div>
      )}

      <details className="game-meta-details">
        <summary>局面阶段与全局备注</summary>
        <div className="field-row two-columns">
          <label>
            <span>阶段</span>
            <select
              value={game.phase}
              onChange={(event) =>
                onGameMetaChange({ phase: event.target.value as GameDraft["phase"] })
              }
            >
              <option value="setup">配置中</option>
              <option value="first_night">首夜</option>
              <option value="day">白天</option>
              <option value="night">夜晚</option>
              <option value="finished">已结束</option>
            </select>
          </label>
          <label>
            <span>天数</span>
            <input
              type="number"
              min={0}
              max={99}
              value={game.day_number}
              onChange={(event) => onGameMetaChange({ day_number: Number(event.target.value) })}
            />
          </label>
        </div>
        <label className="notes-field">
          <span>全局备注</span>
          <textarea
            rows={2}
            maxLength={5000}
            value={game.notes}
            onChange={(event) => onGameMetaChange({ notes: event.target.value })}
          />
        </label>
      </details>
    </section>
  );
}
