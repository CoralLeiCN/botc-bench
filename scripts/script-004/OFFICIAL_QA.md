# 梦殒春宵（Sects & Violets）：基于官方英文规则的问答整理

本页覆盖本剧本全部 25 个非旅行者角色。答案是仓库对官方英文资料所作的简体中文转述，不是 TPI 发布的中文 FAQ 原文、玩家策略建议，也不取代角色历书（Almanac）原文。资料核对日期：**2026-08-31**。

主要依据为 [官方 Wiki 的梦殒春宵角色索引](https://wiki.bloodontheclocktower.com/Sects_%26_Violets)、各角色的 `Summary` / `How to Run` / `Examples`，以及 [官方角色数据](https://github.com/ThePandemoniumInstitute/botc-release/blob/main/resources/data/roles.json)。官方还提供了 [梦殒春宵说书人测验](https://quiz.bloodontheclocktower.com/sects-violets-easy)。

## 通用机制

### 问：“疯狂”是否会强迫玩家说谎？

**答：** 不会。“疯狂”描述玩家是否在努力使其他人相信某件事。玩家始终可以自由发言或沉默，但畸形秀演员或被洗脑师选中的玩家若未满足相应疯狂要求，可能被说书人处决。说书人判断的是整体行为与意图，不是某句固定暗号。[来源：官方 Wiki「Glossary」](https://wiki.bloodontheclocktower.com/Glossary)

### 问：因疯狂而发生的处决会不会占用当天的处决次数？

**答：** 会。白天由畸形秀演员或洗脑师能力造成的处决是当天的处决；通常不能再进行一次常规处决。畸形秀演员若在夜间被处决，则不占用次日的处决。[来源：官方 Wiki「Mutant」](https://wiki.bloodontheclocktower.com/Mutant)、[「Cerenovus」](https://wiki.bloodontheclocktower.com/Cerenovus)

## 镇民

### 钟表匠（Clockmaker）

**问：** 距离怎样计算？

**答：** 从恶魔旁边的第一名玩家开始，沿顺时针或逆时针数到最近的爪牙；取两个方向中的最短距离。初始钟表匠通常只在首夜得知一次；若角色中途被创造，或哲学家中途获得该能力，则在获得时结算一次。[来源：官方 Wiki「Clockmaker」](https://wiki.bloodontheclocktower.com/Clockmaker)、[「Philosopher」](https://wiki.bloodontheclocktower.com/Philosopher)

### 舞蛇人（Snake Charmer）

**问：** 选中恶魔后，谁变成什么？

**答：** 舞蛇人变成该恶魔并转为邪恶；原恶魔变成善良的舞蛇人，并持续中毒。交换的是角色与阵营，不是座位。[来源：官方 Wiki「Snake Charmer」](https://wiki.bloodontheclocktower.com/Snake_Charmer)

### 数学家（Mathematician）

**问：** 数学家会把“中毒”本身计为一次异常吗？

**答：** 不会。只有某项能力确实因另一角色的能力而异常运作时才计数。例如中毒信息角色获得错误信息会计数；若碰巧获得正确信息则不计。数学家也不会检测自己的能力异常。[来源：官方 Wiki「Mathematician」](https://wiki.bloodontheclocktower.com/Mathematician)

### 筑梦师（Dreamer）

**问：** 两个角色信息如何组成？

**答：** 其中一个是被选玩家被能力识别出的真实角色；另一个来自相反阵营类型：目标若是镇民或外来者，假角色为爪牙或恶魔，反之亦然。筑梦师不能选择自己或旅行者。[来源：官方 Wiki「Dreamer」](https://wiki.bloodontheclocktower.com/Dreamer)

### 卖花女孩（Flowergirl）

**问：** 恶魔投票但提名未通过，是否仍会得到“是”？

**答：** 会。只要恶魔在一次正式处决投票中投票就会被检测，与被提名者是否处决无关；旅行者流放等非处决投票不算。若恶魔在其后换人，原恶魔当天的投票仍算。[来源：官方 Wiki「Flowergirl」](https://wiki.bloodontheclocktower.com/Flowergirl)

### 城镇公告员（Town Crier）

**问：** 会得知哪名爪牙提名，或提名了几次吗？

**答：** 不会。只会得知当天是否至少有一名爪牙进行过正式提名。[来源：官方 Wiki「Town Crier」](https://wiki.bloodontheclocktower.com/Town_Crier)

### 神谕者（Oracle）

**问：** 神谕者只计算死亡的爪牙与恶魔吗？

**答：** 不是。所有死亡且当前为邪恶阵营的玩家都计入，包括转为邪恶的镇民、外来者或旅行者。信息在恶魔行动后结算，因此对应黎明时的死亡状态。[来源：官方 Wiki「Oracle」](https://wiki.bloodontheclocktower.com/Oracle)

### 博学者（Savant）

**问：** 说书人是否必须每天主动叫博学者来取信息？

**答：** 不必。博学者要主动私下找说书人，也可以选择当天不询问。正常时两条信息恰好一真一假；醉酒或中毒时可以两真或两假。[来源：官方 Wiki「Savant」](https://wiki.bloodontheclocktower.com/Savant)

### 女裁缝（Seamstress）

**问：** 能选择死亡玩家或旅行者吗？

**答：** 能。唯一的目标限制是不能选择自己；可以选择存活或死亡玩家，也可以选择旅行者。[来源：官方 Wiki「Seamstress」](https://wiki.bloodontheclocktower.com/Seamstress)

### 哲学家（Philosopher）

**问：** 哲学家是变成所选角色，还是只获得能力？

**答：** 只获得能力，角色仍是哲学家。如果该角色在场，该角色玩家会因哲学家能力醉酒；若哲学家死亡、醉酒或中毒而失去能力，该玩家会恢复清醒。后来才进入场的同名角色也会醉酒。[来源：官方 Wiki「Philosopher」](https://wiki.bloodontheclocktower.com/Philosopher)

### 艺术家（Artist）

**问：** 说书人只能回答“是”或“否”吗？

**答：** 艺术家可以私下询问任何是非问题；说书人诚实回答“是”“否”或“我不知道”。问题不限于角色身份，但必须能按这种形式回答。[来源：官方 Wiki「Artist」](https://wiki.bloodontheclocktower.com/Artist)

### 杂耍艺人（Juggler）

**问：** 能重复猜同一玩家或同一角色吗？

**答：** 能。首日可公开猜零至五次，玩家与角色均可重复。若猜测时中毒、但当晚结算时已经健康，仍会得到真实数量。[来源：官方 Wiki「Juggler」](https://wiki.bloodontheclocktower.com/Juggler)

### 贤者（Sage）

**问：** 被处决或被女巫杀死会触发贤者吗？

**答：** 不会。只有恶魔能力杀死贤者时才触发；被处决或由非恶魔能力杀死均不符合条件。[来源：官方 Wiki「Sage」](https://wiki.bloodontheclocktower.com/Sage)

## 外来者

### 心上人（Sweetheart）

**问：** 醉酒持续多久，谁来选择目标？

**答：** 由说书人选择一名玩家，该玩家从此醉酒；心上人死亡后能力仍维持这一效果。[来源：官方 Wiki「Sweetheart」](https://wiki.bloodontheclocktower.com/Sweetheart)

### 呆瓜（Klutz）

**问：** 说书人是否必须提醒呆瓜选择？

**答：** 不必须。呆瓜得知自己死亡后，应在短时间内自行公开选择一名存活玩家；可先听取讨论。选中邪恶玩家时，呆瓜当前所属的阵营立即落败；呆瓜通常为善良，所以通常是善良落败，但已转为邪恶的呆瓜会令邪恶落败。故意拒绝选择属于违规游戏行为。[来源：官方 Wiki「Klutz」](https://wiki.bloodontheclocktower.com/Klutz)

### 理发师（Barber）

**问：** 交换角色时阵营会一起交换吗？新角色的一次性能力还能用吗？

**答：** 阵营不变，只交换角色。玩家获得新角色的完整能力，包括“首夜得知”或“每局一次”能力，即使之前拥有该角色的玩家已经用过。恶魔可以不交换，也可以把自己作为目标，但不能选择另一名恶魔。[来源：官方 Wiki「Barber」](https://wiki.bloodontheclocktower.com/Barber)

### 畸形秀演员（Mutant）

**问：** 只有直接说“我是畸形秀演员”才可能被处决吗？

**答：** 不是。只要说书人判断该玩家正试图让他人相信自己是外来者，就可能处决；暗示、回答方式甚至特定语境下的沉默都可纳入判断。[来源：官方 Wiki「Mutant」](https://wiki.bloodontheclocktower.com/Mutant)

## 爪牙

### 女巫（Witch）

**问：** 被诅咒玩家提名后，是先死亡还是提名失效？

**答：** 该玩家死亡，但提名仍然成立。诅咒只持续到次日结束；场上只剩三名存活玩家时，现有诅咒立即移除，女巫也不再行动。[来源：官方 Wiki「Witch」](https://wiki.bloodontheclocktower.com/Witch)

### 洗脑师（Cerenovus）

**问：** 被选玩家只要暗示自己是指定角色就足够吗？

**答：** 不一定。他应作出合理努力，使其他玩家相信自己是指定的镇民或外来者；说书人可以因努力不足而处决，但“可能”意味着说书人也可选择不处决，尤其要避免让邪恶玩家借此故意获利。[来源：官方 Wiki「Cerenovus」](https://wiki.bloodontheclocktower.com/Cerenovus)

### 麻脸巫婆（Pit-Hag）

**问：** 能制造一个已经在场的角色吗？制造恶魔后谁死亡？

**答：** 不能制造重复角色；目标角色已在场时不会发生变化。如果成功制造恶魔，当晚死亡改由说书人任意决定，而不是正常按各杀人能力机械结算。[来源：官方 Wiki「Pit-Hag」](https://wiki.bloodontheclocktower.com/Pit-Hag)

### 镜像双子（Evil Twin）

**问：** 处决邪恶双子会让善良立刻获胜吗？

**答：** 处决邪恶双子本身没有独立胜利效果；若恶魔仍存活，游戏继续；若恶魔已死且没有其他效果阻止善良获胜，邪恶双子死亡并失去能力后善良立即获胜。处决善良双子会令邪恶立即获胜。一般情况下邪恶双子死亡即失去能力；但若被仍存活且拥有能力的亡骨魔杀死，邪恶双子会保留能力，在该效果持续期间处决善良双子仍令邪恶获胜。[来源：官方 Wiki「Evil Twin」](https://wiki.bloodontheclocktower.com/Evil_Twin)、[「Vigormortis」](https://wiki.bloodontheclocktower.com/Vigormortis)

## 恶魔

### 诺-达鲺（No Dashii）

**问：** “邻近的两名镇民”是否必须与恶魔座位直接相邻？

**答：** 不是。沿两个方向分别寻找最近的镇民，跳过外来者、爪牙与旅行者，死亡镇民也可以中毒。诺-达鲺死亡或失去能力时，这两名镇民恢复健康；角色分布变化时中毒目标会立即重算。[来源：官方 Wiki「No Dashii」](https://wiki.bloodontheclocktower.com/No_Dashii)

### 亡骨魔（Vigormortis）

**问：** 亡骨魔杀死的爪牙能保留多久能力？谁中毒？

**答：** 只要亡骨魔仍有能力，被它杀死的每名爪牙都保留能力。每名这种爪牙还会令其两个方向最近的镇民之一中毒，由说书人选择；非镇民会被跳过。亡骨魔失去能力时，这些效果停止。[来源：官方 Wiki「Vigormortis」](https://wiki.bloodontheclocktower.com/Vigormortis)

### 涡流（Vortox）

**问：** 涡流要求哪些信息为假？旅行者流放能避免当日邪恶获胜吗？

**答：** 镇民因自身能力获得的信息必须为假，即使该镇民同时醉酒或中毒；规则说明、角色或阵营变化通知不属于这类信息。每天必须发生一次处决，流放旅行者不算处决。[来源：官方 Wiki「Vortox」](https://wiki.bloodontheclocktower.com/Vortox)

### 方古（Fang Gu）

**问：** 只要攻击外来者就一定跳转吗？新方古会重新认识爪牙吗？

**答：** 只有本局首次由方古能力实际杀死外来者时才跳转；若外来者没有死亡，则双方均不变化。外来者变成邪恶方古，原方古代替他死亡；新方古不会因此重新得知爪牙是谁。[来源：官方 Wiki「Fang Gu」](https://wiki.bloodontheclocktower.com/Fang_Gu)

## 剧本内高频互动

### 问：涡流在场时，博学者仍是一真一假吗？

**答：** 不是。博学者是镇民，其能力给出的信息都必须错误，所以两条信息都应为假；同理，艺术家的答案也必须构成错误信息。[来源：官方 Wiki「Vortox」](https://wiki.bloodontheclocktower.com/Vortox)、[「Savant」](https://wiki.bloodontheclocktower.com/Savant)

### 问：方古跳转会触发心上人、呆瓜或理发师的死亡能力吗？

**答：** 不会。成功跳转时，被攻击的外来者没有死亡，而是变成邪恶方古；因此这些“当你死亡时”能力不触发。死亡的是原方古。[来源：官方 Wiki「Fang Gu」](https://wiki.bloodontheclocktower.com/Fang_Gu)

### 问：舞蛇人成功交换后，当晚由新恶魔继续杀人吗？

**答：** 按夜间顺序处理：舞蛇人变成恶魔后，会在该恶魔的夜间行动时点正常行动（若该时点尚未经过）；原恶魔是善良且持续中毒的舞蛇人。[来源：官方 Wiki「Snake Charmer」](https://wiki.bloodontheclocktower.com/Snake_Charmer)

## 维护说明

- 角色能力、相克规则（Jinx）或官方 Wiki 可能更新；实现 benchmark 前应重新核对 [官方 Changelog](https://wiki.bloodontheclocktower.com/Changelog) 与 [官方 App 数据](https://github.com/ThePandemoniumInstitute/botc-release/tree/main/resources/data)。
- 本页只覆盖该基础剧本自身的角色组合；加入旅行者、传奇角色或其他自定义角色后，应再查对应角色页及 [Djinn / Jinx 规则](https://wiki.bloodontheclocktower.com/Djinn)。
