import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  CircleDot,
  Eye,
  Plus,
  Skull,
  Trash2,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { allRoles, marker, TEAM_LABELS } from "../game";
import type { GameDraft, MarkerType, Script, Seat, Team } from "../types";

interface InspectorProps {
  readOnly?: boolean;
  game: GameDraft;
  script: Script;
  seat: Seat | null;
  onSeatChange: (seat: Seat) => void;
  onMoveSeat: (direction: -1 | 1) => void;
  onGameMetaChange: (patch: Partial<Pick<GameDraft, "phase" | "day_number" | "notes" | "public_information">>) => void;
  onViewAsPlayer: (seatId: string) => void;
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
  readOnly = false,
  game,
  script,
  seat,
  onSeatChange,
  onMoveSeat,
  onGameMetaChange,
  onViewAsPlayer,
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
    if (!seat || !label || seat.markers.length >= 32) return;
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
            <button disabled={readOnly} type="button" onClick={() => onMoveSeat(-1)} title="逆时针移动">
              <ArrowLeft size={14} />
            </button>
            <button disabled={readOnly} type="button" onClick={() => onMoveSeat(1)} title="顺时针移动">
              <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>

      {seat && (
        <button type="button" className="view-as-button" onClick={() => onViewAsPlayer(seat.id)}>
          <Eye size={15} /> 以此玩家视角查看
        </button>
      )}

      {!seat ? (
        <div className="empty-state">
          <CircleDot size={24} />
          <p>点击魔典中的座位开始编辑。</p>
        </div>
      ) : (
        <fieldset className="inspector-form inspector-fields" disabled={readOnly}>
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
              <span>真实阵营</span>
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

          {!seat.alive && <label className="dead-vote-toggle">
            <input type="checkbox" checked={seat.dead_vote_available}
              onChange={(event) => onSeatChange({ ...seat, dead_vote_available: event.target.checked })} />
            亡者票可用（剩余 {seat.dead_vote_available ? 1 : 0} 票）
          </label>}
          <fieldset className="knowledge-fields">
            <legend>玩家可见信息</legend>
            <div className="field-row two-columns">
              <label>
                <span>展示角色</span>
                <select
                  value={seat.shown_role_id ?? ""}
                  onChange={(event) => onSeatChange({ ...seat, shown_role_id: event.target.value || null })}
                >
                  <option value="">未告知 / 未记录</option>
                  {availableRoles.map((item) => (
                    <option key={item.id} value={item.id}>{item.name.zh_hans} · {item.name.en}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>告知阵营</span>
                <select value={seat.shown_alignment} onChange={(event) =>
                  onSeatChange({ ...seat, shown_alignment: event.target.value as Seat["shown_alignment"] })
                }>
                  <option value="unknown">未告知 / 未记录</option>
                  <option value="good">善良</option>
                  <option value="evil">邪恶</option>
                </select>
              </label>
            </div>
            <p className="field-hint">单独记录玩家收到的身份；真实角色变更不会自动改写展示角色。</p>
            <label className="notes-field">
              <span>公开声明 · 所有玩家可见</span>
              <textarea rows={2} maxLength={2000} value={seat.public_claim}
                placeholder="如：我声称是共情者，昨晚得知 0。"
                onChange={(event) => onSeatChange({ ...seat, public_claim: event.target.value })} />
            </label>
            <label className="notes-field">
              <span>私人信息 · 仅此玩家可见</span>
              <textarea rows={3} maxLength={5000} value={seat.private_information}
                placeholder="逐条记录此玩家实际收到的信息，如：首夜得知 0。包括获知的队友或私聊原话。"
                onChange={(event) => onSeatChange({ ...seat, private_information: event.target.value })} />
            </label>
          </fieldset>

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
                    disabled={!active && seat.markers.length >= 32}
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
              <button type="button" onClick={addCustom} disabled={!customMarker.trim() || seat.markers.length >= 32}>
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
            <span>说书人备注 · 对玩家隐藏</span>
            <textarea
              value={seat.notes}
              onChange={(event) => onSeatChange({ ...seat, notes: event.target.value })}
              rows={2}
              maxLength={2000}
              placeholder="隐藏状态、结算依据、说书人提醒…"
            />
          </label>
        </fieldset>
      )}

      <details className="game-meta-details">
        <summary>局面阶段与全局备注</summary>
        <fieldset className="inspector-fields" disabled={readOnly}>
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
                onChange={(event) => onGameMetaChange({ day_number: Math.max(0, Math.min(99, Math.round(Number(event.target.value) || 0))) })}
              />
            </label>
          </div>
          <label className="notes-field">
            <span>公开信息 · 所有玩家可见</span>
            <textarea rows={3} maxLength={5000} value={game.public_information}
              placeholder="公告、提名、投票、公开发言等。"
              onChange={(event) => onGameMetaChange({ public_information: event.target.value })} />
          </label>
          <label className="notes-field">
            <span>全局备注 · 对玩家隐藏</span>
            <textarea
              rows={2}
              maxLength={5000}
              value={game.notes}
              onChange={(event) => onGameMetaChange({ notes: event.target.value })}
            />
          </label>
        </fieldset>
      </details>
    </section>
  );
}
