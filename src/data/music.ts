export type Song = {
  title: string;
  artist: string;
  cover: string;
  audio: string;
  note?: string;
  lrc?: string;
};

// 《鸣潮》音乐(本地自托管):音频/封面/歌词在 public/music/,替换即改此文件。
export const playlist: Song[] = [
  {
    title: "Waking of a World",
    artist: "TerryZhong钟天利 / 炎明熹",
    cover: '/music/covers/cover-1.jpg',
    audio: '/music/audio/song-1.mp3',
    note: "《鸣潮》公测主题曲",
    lrc: `{"t":0,"c":[{"tx":"特别呈现: "},{"tx":"先约电台"}]}
{"t":1000,"c":[{"tx":"制作人: "},{"tx":"Terry Zhong钟天利"}]}
{"t":2000,"c":[{"tx":"作曲: "},{"tx":"Terry Zhong钟天利"}]}
{"t":3000,"c":[{"tx":"作词: "},{"tx":"黑金雨"}]}
{"t":4000,"c":[{"tx":"演唱: "},{"tx":"炎明熹"}]}
{"t":5000,"c":[{"tx":"配唱制作人: "},{"tx":"刘易升"}]}
{"t":6000,"c":[{"tx":"录音师: "},{"tx":"许钊荣 @ Heaven Studio"}]}
{"t":7000,"c":[{"tx":"录音棚: "},{"tx":"Heaven Studio"}]}
{"t":8000,"c":[{"tx":"编曲: "},{"tx":"Terry Zhong钟天利"}]}
{"t":9000,"c":[{"tx":"混音: "},{"tx":"Terry Zhong钟天利"}]}
{"t":10000,"c":[{"tx":"母带: "},{"tx":"Terry Zhong钟天利"}]}
{"t":11000,"c":[{"tx":"版权: "},{"tx":"Enjoy The Music Ltd."}]}
[00:19.520]尝试颠覆偏转 一些
[00:23.840]牵引命运的弧线
[00:28.350]流光中漂泊的 和弦
[00:32.330]与心声重连接
[00:36.900]听见微渺振频 如萤灯 不屈不绝
[00:41.100]穿透寂静黑夜 燎荒原 不休不歇
[00:45.470]激荡于天地并非音量的极限
[00:48.750]让我们的共鸣汇聚到质变
[00:52.750]就是现在
[00:55.200]旧边界 新旷野
[00:57.190]循环破开
[00:59.410]宣告无解被终结
[01:01.480]挣脱樊笼安排
[01:06.790]自沉默旧规之外
[01:08.960]我将与新浪潮同来
[01:47.670]胆怯 退却 迷失 搁浅
[01:52.810]都跨越
[01:56.300]凭群星俯瞰
[01:58.920]我逆流
[02:01.420]重塑奇点
[02:03.720]You and I
[02:04.680]听见微渺振频 如萤灯 不屈不绝
[02:09.060]穿透寂静黑夜 燎荒原 不休不歇
[02:13.320]激荡于天地并非音量的极限
[02:16.840]让我们的共鸣汇聚到质变
[02:20.570]残象掀翻
[02:23.070]旧余响 新鼓点
[02:24.940]前路豁然
[02:27.300]创建与你的章节
[02:29.250]挣脱樊笼安排
[02:34.710]自荒芜旧日之外
[02:36.680]我将与新未来同来
[02:54.820]就是现在
[02:57.330]旧边界 新旷野
[02:59.310]循环破开
[03:01.530]宣告无解被终结
[03:03.600]挣脱樊笼安排
[03:08.920]自沉默旧规之外
[03:11.090]我正与新浪潮同来`,
  },
  {
    title: "愿戴荣光坠入天渊",
    artist: "jixwang / VISION SOUND",
    cover: '/music/covers/cover-2.jpg',
    audio: '/music/audio/song-2.mp3',
    note: "卡提希娅主题曲",
    lrc: `{"t":0,"c":[{"tx":"作词 Lyricist: "},{"tx":"Xulai"}]}
{"t":1000,"c":[{"tx":"作曲 Composer: "},{"tx":"jixwang","li":"http://p1.music.126.net/BPFwKES7L6_QtLs0IcqMtw==/109951165820162174.jpg","or":"orpheus://nm/artist/home?id=13005455&type=artist"}]}
{"t":2000,"c":[{"tx":"编曲 Arranger: "},{"tx":"jixwang","li":"http://p1.music.126.net/BPFwKES7L6_QtLs0IcqMtw==/109951165820162174.jpg","or":"orpheus://nm/artist/home?id=13005455&type=artist"}]}
{"t":3000,"c":[{"tx":"演唱 Vocal: "},{"tx":"VISION SOUND "}]}
{"t":4000,"c":[{"tx":"混音 Mixing Engineer: "},{"tx":"张步若@RSS Studio"}]}
{"t":5000,"c":[{"tx":"乐器独奏Solo: "},{"tx":"Guitar：愤怒的糖"}]}
{"t":6000,"c":[{"tx":"母带工程师 Mastering Engineer: "},{"tx":"张步若@RSS Studio"}]}
{"t":7000,"c":[{"tx":"音乐总监Music Director: "},{"tx":"jixwang"}]}
{"t":8000,"c":[{"tx":"助理 Assistant: "},{"tx":"A19 / TLK天翔"}]}
{"t":9000,"c":[{"tx":"出品 Produced by: "},{"tx":"鸣潮先约电台"}]}
[00:17.871]Could you spare a second
[00:20.184]slow your pace, listen
[00:22.350]to the story of Cartethyia
[00:26.956]She called for freedom
[00:29.098]she yearned for legend
[00:31.219]dreaming of splendid adventure：
[00:36.134]“Will the prophecy manifest
[00:40.560]will I be the maiden who's blessed
[00:44.667]then I'll walk down the glory path
[00:49.084]bring honor and brightness back
[00:53.912]Wipe out all the enemies in sight
[00:58.003]There's no turning back this time
[01:02.144]Will it realize, Will it realize
[01:06.200]Will the laurel be placed on my head
[01:11.455]one day we shall cheer and dance
[01:16.172]making joy forever last”
[01:30.122]the prophecy is nothing
[01:32.098]but a vicious lie
[01:34.324]here comes the growling Dark Tide
[01:38.711]the more pain she feels
[01:41.113]the clearer she sees
[01:43.035]haloes of divine are fading
[01:48.151]“I can hear the bell of fate sounds
[01:52.518]It's high time to turn it around
[01:56.517]I'll carry on my glorious journey
[02:00.436]with the blessings and wish by my side
[02:05.894]won't accept the fate that is set
[02:10.215]There's no turning back this time
[02:14.040]This will realize, it will realize
[02:18.089]Truth in my heart never dies
[02:23.380]I'll pierce through all the veils of lies
[02:28.028]with this silver sword in my hand,Annh ~
[02:33.195]Divinity
[02:34.913]blindfolded me
[02:37.206]wrapped me in lies
[02:39.466]like ocean’s mist
[02:41.848]I'm still that girl
[02:43.971]carrying the hopes
[02:46.244]I'll break the shackles
[02:48.386]free the souls trapped in those dark worlds
[02:58.490]Nothing can stop me walking down this path
[03:03.176]bringing honor and blessings back
[03:07.520]won't accept the fate that is set
[03:11.939]There's no turning back this time
[03:15.849]Will it be true, Will it be true
[03:20.035]be a closure for this myth book
[03:25.493]one day we shall cheer and dance
[03:29.861]making joy forever last”`,
  },
  {
    title: "涤罪的咏叹调",
    artist: "十音",
    cover: '/music/covers/cover-3.jpg',
    audio: '/music/audio/song-3.mp3',
    note: "罗蕾莱 Boss 主题曲",
    lrc: `{"t":0,"c":[{"tx":"作曲 Composer: "},{"tx":"十音"},{"tx":"/"},{"tx":"jixwang"}]}
{"t":416,"c":[{"tx":"编曲 Arranger: "},{"tx":"十音"}]}
{"t":832,"c":[{"tx":"混音师 Mixing Engineer: "},{"tx":"十音"}]}
{"t":1248,"c":[{"tx":"乐团 Orchestra：Budapest Scoring Orchestra"}]}
{"t":1664,"c":[{"tx":"乐器独奏Solo：Vocal - 十七刀"}]}
{"t":2080,"c":[{"tx":"指挥 Conductor：Peter Illenyi"}]}
{"t":2496,"c":[{"tx":"录音棚 Studio：Rottenbiller Studio（Budapest, Hungary）"}]}
{"t":2912,"c":[{"tx":"录音师 Recording Engineer ：Viktor Szende"}]}
{"t":3328,"c":[{"tx":"承办人（Contractor）/录音监制 Recording Producer：黄智骞、十音"}]}
{"t":3744,"c":[{"tx":"监制 Recording Supervisor：jixwang"}]}
{"t":4160,"c":[{"tx":"母带工程师 Mastering Engineer：jixwang"}]}
{"t":4576,"c":[{"tx":"出品 Produced by：鸣潮先约电台"}]}
[00:05.00]纯音乐，请欣赏`,
  },
  {
    title: "今州鸾鸣",
    artist: "梨华rika / 不要杀我!",
    cover: '/music/covers/cover-4.jpg',
    audio: '/music/audio/song-4.mp3',
    note: "长离与今汐师徒印象曲",
    lrc: `{"t":0,"c":[{"tx":"作词: "},{"tx":"梨华rika","li":"http://p1.music.126.net/8ztNf4L7coEkdBl_YaQjtA==/109951165018020054.jpg","or":"orpheus://nm/artist/home?id=28187377&type=artist"}]}
[00:01.710]今州鸾鸣
[00:06.606]《鸣潮》一周年庆——长离与今汐师徒印象曲
[00:11.478]作词：梨华
[00:14.646]作曲：安知何在
[00:16.246]编曲：卿歌
[00:18.062]混音：没招
[00:20.838]演唱：今汐-梨华 长离-不要杀我
[00:29.229]视频剪辑：梨华（素材来源：《鸣潮》官方视频）
[00:29.414]梨华：千灯织云裳
[00:31.862]风起 铃晃
[00:35.974]见霁寒浮光
[00:38.710]映轩窗
[00:42.486]乘岁凌霄
[00:48.782]星盏 可点今州街巷
[00:55.894]不要杀我：凤涅槃 朱砂
[00:59.373]落纸张
[01:02.926]灰烬中 绽放
[01:06.126]亘古煌煌
[01:09.486]翎羽 划破苍茫
[01:15.901]焚烬 八荒
[01:22.366]梨华：可照永夜无疆
[01:25.639]此身为炬化千浪
[01:29.246]愿天怜苍生
[01:32.357]今州锦绣 月照西江
[01:36.118]不要杀我：生怕掌纹灼伤
[01:39.014]弈者棋局锁流光
[01:42.646]乌鹭已泛黄
[01:45.646]合：万物流转 尘世千古 谁藏
[02:19.330]不要杀我：发梢尾 染斜阳
[02:22.034]再添上 红妆
[02:26.106]离火照丹心
[02:28.722]再绽放
[02:32.627]执子 任天倾
[02:38.739]炽翎 瞬烬点燃未央
[02:45.834]梨华：见晨曦微凉
[02:49.674]映粼光
[02:52.738]听万象回响
[02:56.270]风渡千嶂
[02:59.542]逐天 神霓飞芒
[03:05.853]韶华成章
[03:12.598]不要杀我：玲珑骰 红袖香
[03:15.765]黑白之间 征天光
[03:19.470]涤尽尘寰霜
[03:22.454]褪羽成刃 刺破山江
[03:26.086]梨华：莫怕荆棘路长
[03:29.054]浮生皆可寄万象
[03:32.870]新雪落陈酿
[03:35.678]合：晚风舟漾 万家灯火 明亮
[03:42.942]合：回首望
[03:49.430]静听琴弦流淌
[03:56.173]碎玉拥琳琅
[04:02.662]看 凤凰衔春信 诉过往`,
  },
  {
    title: "持续瞬间的永恒",
    artist: "jixwang / markmilian",
    cover: '/music/covers/cover-5.jpg',
    audio: '/music/audio/song-5.mp3',
    note: "尤诺 BGM",
    lrc: `{"t":0,"c":[{"tx":"作曲 Composer: "},{"tx":"jixwang"}]}
{"t":766,"c":[{"tx":"编曲 Arranger: "},{"tx":"jixwang"}]}
{"t":1532,"c":[{"tx":"弦乐编写 Strings Arrangement: "},{"tx":"markmilian"}]}
{"t":2298,"c":[{"tx":"作词 Lyricist: "},{"tx":"XuLai"}]}
{"t":3064,"c":[{"tx":"演唱 Vocal: "},{"tx":"Sophia"}]}
{"t":3830,"c":[{"tx":"混音 Mixing Engineer: "},{"tx":"张步若@RSS Studio"}]}
{"t":4596,"c":[{"tx":"乐团 Orchestra: "},{"tx":"室屋 光一郎ストリングス Koichiro Muroya Strings"}]}
{"t":5362,"c":[{"tx":"Violin solo: "},{"tx":"室屋 光一郎 Koichiro Muroya"}]}
{"t":6128,"c":[{"tx":"Guitar solo: "},{"tx":"愤怒的糖"}]}
{"t":6894,"c":[{"tx":"Drum solo: "},{"tx":"中村 誠"}]}
{"t":7660,"c":[{"tx":"指挥 Conductor: "},{"tx":"山下 康介 Kosuke Yamashita"}]}
{"t":8426,"c":[{"tx":"录音棚 Studio: "},{"tx":"キング関口台スタジオ King Sekiguchidai Studio"}]}
{"t":9192,"c":[{"tx":"录音师 Recording Engineer: "},{"tx":"立石 佑太 Yuta Tateishi"}]}
{"t":9958,"c":[{"tx":"录音承办人Recording Contractor: "},{"tx":"VISION SOUND"},{"tx":"/"},{"tx":"里見 勉（SHANGRI-LA INC.）Tsutomu Satomi （SHANGRI-LA INC.）"},{"tx":"/"},{"tx":"无糖宁宁子 @再定义Studio"}]}
{"t":10724,"c":[{"tx":"监制 Music Supervisor: "},{"tx":"jixwang"}]}
{"t":11490,"c":[{"tx":"母带工程 Mastering Engineer: "},{"tx":"张步若@RSS Studio"}]}
{"t":12256,"c":[{"tx":"助理 Assistant: "},{"tx":"Ream雨舒"},{"tx":"/"},{"tx":"TLK天翔"}]}
{"t":13022,"c":[{"tx":"谱务 Scoring: "},{"tx":"markmilian"}]}
{"t":13788,"c":[{"tx":"出品 Produced by: "},{"tx":"鸣潮先约电台"}]}
[00:14.565]Your voice echoed through my mind
[00:20.713]Led me through abyss of chaos
[00:26.639]Finally you're here with me
[00:32.827]It is too surreal for me to blink
[00:39.363]Just spin me back to your gravity
[00:45.974]I’ll orbit you in every galaxy
[00:52.798]Tighten your grip if you doubt this is a dream
[00:58.602]Let my pulse speak for me
[01:02.199]All my pains are gone when you're near
[01:23.098]The world is softly breathing
[01:29.819]As moonbeams filling up the void
[01:35.587]Every scratch we can't undo
[01:41.983]is a bridge to tomorrow's dawn
[01:48.473]Just spin me back to your gravity
[01:54.748]I’ll circle you through all eternity
[02:01.666]Your fingertips pour moonlight all through me
[02:07.570]Rewrite the prophecy
[02:11.183]Suddenly the sky has no limit
[02:17.772]Are you real
[02:19.275]Will you stay
[02:21.059]Shall we slow down our pace
[02:24.148]Let this fleeting moment stretch to an endless always
[02:30.908]I'll reach for your hands again and again
[02:37.927]Spin me back to your gravity
[02:44.303]I’ll trace you across all possibilities
[02:51.035]So even if I'm erased by time
[02:57.005]I'll follow echoes of memories to find you once more`,
  },
  {
    title: "悠忽舞于梦中",
    artist: "jixwang / VISION SOUND",
    cover: '/music/covers/cover-6.jpg',
    audio: '/music/audio/song-6.mp3',
    note: "罗蕾莱云海隐藏约会曲",
    lrc: `{"t":0,"c":[{"tx":"作曲 Composer: "},{"tx":"jixwang"}]}
{"t":562,"c":[{"tx":"编曲 Arranger: "},{"tx":"jixwang"}]}
{"t":1124,"c":[{"tx":"作词 Lyricist: "},{"tx":"XuLai"}]}
{"t":1686,"c":[{"tx":"演唱Vocal by：VISION SOUND"}]}
{"t":2248,"c":[{"tx":"弦乐编写Strings by：jixwang"}]}
{"t":2810,"c":[{"tx":"木吉他演奏：愤怒的糖"}]}
{"t":3372,"c":[{"tx":"混音师 Mixing Engineer：张步若@RRS Studio"}]}
{"t":3934,"c":[{"tx":"母带工程师 Mastering Engineer：张步若@RRS Studio"}]}
{"t":4496,"c":[{"tx":"录音棚 Studio：无音区杜比全景声棚"}]}
{"t":5058,"c":[{"tx":"录音师 Recording Engineer ：VISION SOUND"}]}
{"t":5620,"c":[{"tx":"监制 Recording Supervisor：jixwang"}]}
{"t":6182,"c":[{"tx":"助理Assistant：TLK天翔"}]}
{"t":6744,"c":[{"tx":"出品 Produced by：鸣潮先约电台"}]}
[00:07.31]I can see the dawn on water’s face
[00:13.15]With the shimmering light that starts to race
[00:19.47]Interwoven strokes that rise and breathe
[00:26.66]Each mark I make a trace beneath
[00:32.27]Feathers shed their golden gleam
[00:36.80]Drifting notes like a gentle dream
[00:41.91]In my heart the lightness secretly strikes a chord
[00:50.62]When time is fluid like red wine in my bottle
[00:58.88]Then it pours out a page of rhythm and rhyme
[01:05.31]Can we set our sail again
[01:09.49]To the rainbows arching up high
[01:14.56]Gondola fying in the sky
[01:18.04]Once there was a bird
[01:20.77]Swam around the oar
[01:24.68]Then we had to stop
[01:27.96]To hear its secrets unfold
[01:31.19]Was it yesterday, was it last year
[01:37.41]It's so surreal, when salty air was blowing
[01:44.26]Filling up my nose
[01:50.09]Can we set our sail again
[01:55.36]To the beating heart of the sky
[02:00.49]Where grandma resting her smile
[02:04.08]Let's go present her a bunch of daisies
[02:10.43]Like grandpa once did, and sing her a lullaby
[02:17.09]I dreamed about it all last night
[02:22.16]clouds and rainbow intertwined
[02:27.05]Blurring up my track of time
[02:30.31]Grandpa's holding me
[02:33.55]Like I'm still that kid
[02:36.68]Knowing nothing about how to fish and how to live
[02:43.37]I'm still figuring out my life
[02:49.40]Like the first time tangled by the fishing line
[02:57.73]I wish you are still by my side`,
  },
  {
    title: "尘外客",
    artist: "蔡明希(不才) / 宫阁",
    cover: '/music/covers/cover-7.jpg',
    audio: '/music/audio/song-7.mp3',
    note: "",
    lrc: `{"t":0,"c":[{"tx":"出品: "},{"tx":"鸣潮先约电台"}]}
{"t":1000,"c":[{"tx":"演唱: "},{"tx":"蔡明希（不才）"}]}
{"t":2000,"c":[{"tx":"制作人: "},{"tx":"宫阁"}]}
{"t":3000,"c":[{"tx":"作曲: "},{"tx":"VNTA"},{"tx":"/"},{"tx":"Koumi","li":"http://p1.music.126.net/lLliJ75e9X7yamt_AaYb6g==/109951167527788942.jpg","or":"orpheus://nm/artist/home?id=52882247&type=artist"}]}
{"t":4000,"c":[{"tx":"作词: "},{"tx":"栗稚子","li":"http://p1.music.126.net/Bwa0YZjoU8bHRONeEISx6w==/109951165004882315.jpg","or":"orpheus://nm/artist/home?id=31915728&type=artist"}]}
{"t":5000,"c":[{"tx":"编曲: "},{"tx":"宫阁"}]}
{"t":6000,"c":[{"tx":"古琴: "},{"tx":"翟忻来"}]}
{"t":7000,"c":[{"tx":"配唱制作: "},{"tx":"成若颖"},{"tx":"/"},{"tx":"张靖怡"}]}
{"t":8000,"c":[{"tx":"和声/伴唱: "},{"tx":"李沫非"}]}
{"t":9000,"c":[{"tx":"和声编写: "},{"tx":"予木"}]}
{"t":10000,"c":[{"tx":"录音工程师: "},{"tx":"张宇涵@55TEC"}]}
{"t":11000,"c":[{"tx":"混音: "},{"tx":"宫阁"}]}
{"t":12000,"c":[{"tx":"母带: "},{"tx":"Dave Kutch @The Mastering Palace"}]}
{"t":13000,"c":[{"tx":"音乐监制: "},{"tx":"Steven Tang"},{"tx":"/"},{"tx":"ShawWZ"},{"tx":"/"},{"tx":"SmileL"}]}
[00:28.561]
[00:33.297]垂眸见 故城尽焚
[00:37.666]旧音再不闻
[00:40.337]苔上剑痕不记年轮
[00:44.913]月冷对孤坟
[00:46.681]弦音间清浅旧纹
[00:51.817]澹然看劫尘
[00:53.673]终孑然一身
[00:58.920]剑光仍有余温
[01:01.557]心湖间万卷封存
[01:05.925]无恨亦无嗔
[01:07.965]待心魔叩门
[01:13.037]蜕不去凡尘
[01:14.949]照见玉魄魂
[01:20.085]捧一抹残春
[01:22.061]终守护众生一寸
[01:28.461]侧耳听谁言无牵无怨
[01:31.414]饮不尽青锋霜雪
[01:34.574]偏宁做一介过客
[01:37.590]孤影入残世间
[01:41.917]斩断浮尘则无嗔无缘
[01:45.493]却奈何此心未却
[01:48.693]尘间云烟
[01:51.429]唤我回眸万千
[02:26.245]山中影不知晨昏
[02:30.646]因果处生根
[02:33.213]何须执念何来不忍
[02:37.597]皆不必再封存
[02:39.422]空谷间万籁收声
[02:44.782]悲鸣穿云阵
[02:46.541]若照见这凡尘
[02:51.493]染过苍生泪痕
[02:56.806]侧耳听谁言无牵无怨
[02:59.629]饮不尽青锋霜雪
[03:02.797]偏宁做一介过客
[03:05.725]孤影入残世间
[03:09.866]斩断浮尘则无嗔无缘
[03:13.742]却奈何此心未却
[03:17.087]尘间云烟
[03:23.198]唤我回眸万千`,
  },
  {
    title: "定玄",
    artist: "黄霄雲 / 杨秉音",
    cover: '/music/covers/cover-8.jpg',
    audio: '/music/audio/song-8.mp3',
    note: "",
    lrc: `{"t":-1000,"c":[{"tx":"出品: "},{"tx":"鸣潮先约电台"}]}
{"t":-965,"c":[{"tx":"演唱: "},{"tx":"黄霄雲"}]}
{"t":-930,"c":[{"tx":"制作人: "},{"tx":"杨秉音@TME制作人联盟"}]}
{"t":-895,"c":[{"tx":"作曲: "},{"tx":"杨秉音@TME制作人联盟"}]}
{"t":-860,"c":[{"tx":"作词: "},{"tx":"申名利","li":"http://p1.music.126.net/neNOnm-XjKIVQf-I5HGDjA==/109951162957634083.jpg","or":"orpheus://nm/artist/home?id=12479606&type=artist"}]}
{"t":-825,"c":[{"tx":"编曲: "},{"tx":"李牧野"}]}
{"t":-790,"c":[{"tx":"人声和声: "},{"tx":"刘牧"},{"tx":"/"},{"tx":"夏初安"}]}
{"t":-755,"c":[{"tx":"配唱制作人: "},{"tx":"杨秉音@TME制作人联盟"}]}
{"t":-720,"c":[{"tx":"人声录音: "},{"tx":"孔令祎@TONGX"}]}
{"t":-685,"c":[{"tx":"人声录音棚: "},{"tx":"奕星宇音乐"}]}
{"t":-650,"c":[{"tx":"古筝: "},{"tx":"张梦娴"}]}
{"t":-615,"c":[{"tx":"古琴: "},{"tx":"武怀琛"}]}
{"t":-580,"c":[{"tx":"吉他: "},{"tx":"李牧野"}]}
{"t":-545,"c":[{"tx":"贝斯: "},{"tx":"袁野"}]}
{"t":-510,"c":[{"tx":"鼓: "},{"tx":"蔡重阳"}]}
{"t":-475,"c":[{"tx":"乐器录音: "},{"tx":"熊维伟@有沐 · 林边早春"}]}
{"t":-440,"c":[{"tx":"乐器录音棚: "},{"tx":"有沐 · 林边早春@Yum Studio V3"}]}
{"t":-405,"c":[{"tx":"混音: "},{"tx":"李牧野"}]}
{"t":-370,"c":[{"tx":"母带: "},{"tx":"全相彦"}]}
{"t":-335,"c":[{"tx":"企划统筹: "},{"tx":"王晓倩"},{"tx":"/"},{"tx":"付欣"}]}
{"t":-300,"c":[{"tx":"音乐制作公司: "},{"tx":"秉音创声"}]}
{"t":-265,"c":[{"tx":"项目执行: "},{"tx":"赵金爽"}]}
{"t":-230,"c":[{"tx":"商务统筹: "},{"tx":"刘嘉盛"},{"tx":"/"},{"tx":"侯爽"}]}
{"t":-195,"c":[{"tx":"项目监制: "},{"tx":"李静楠"}]}
{"t":-160,"c":[{"tx":"出品人: "},{"tx":"曾志中"},{"tx":"/"},{"tx":"杨薇"}]}
{"t":-125,"c":[{"tx":"音乐出品: "},{"tx":"制作家工作室（大玩+）"}]}
{"t":-90,"c":[{"tx":"音乐监制: "},{"tx":"Steven Tang"},{"tx":"/"},{"tx":"ShawWZ"}]}
{"t":-55,"c":[{"tx":"特别鸣谢: "},{"tx":"黄霄雲工作室"}]}
[00:00.000]
[00:16.779]鸢鸟起 轻点流云 画一城涟漪
[00:23.903]曲水绕园林 潮涌往昔
[00:28.264]望亭台静立 日影西移
[00:32.271]水中鲤 游遍霞锦 窥识梦中谜
[00:38.824]虚实待客寻 此间幽境
[00:42.703]一弦清一心 藏剑于音
[00:47.264]身入局 掠阵敌影
[00:51.079]刃起处 劈开雾中囚境
[00:56.808]岂肯 再忍命
[01:03.415]月下旋身赴此间
[01:06.895]点水开道惊鸿现
[01:10.775]手执玄机引流电
[01:13.599]共守 一方桃源
[01:18.072]千楼万儡遮天
[01:21.793]锁不尽人心恶念
[01:25.752]杀意如潮般扑卷
[01:28.808]看我 以声化雨净 人间
[01:44.015]鸢鸟起 细雨穿檐 拢一池涟漪
[01:50.463]游廊风声急 草木皆敌
[01:54.935]望亭台暗处 步步杀意
[01:59.233]竹叶低 垂露凝锋 列阵伺雷霆
[02:05.735]看不速之客 贪念随形
[02:09.575]生死局中弈 难掩悲鸣
[02:14.241]心傀出 六欲横行
[02:17.832]刃起处 劈开昔日血影
[02:23.639]岂肯 再忍命
[02:28.505]月下旋身赴此间
[02:32.050]点水开道惊鸿现
[02:35.826]手执玄机引流电
[02:38.769]共守 一方桃源
[02:43.168]千楼万儡遮天
[02:47.154]锁不尽人心恶念
[02:50.872]杀意如潮般扑卷
[02:53.920]看我 以声化雨净 人间
[03:23.354]天地失序如寒渊
[03:26.913]字粒游走复青檐
[03:30.706]莲舟一叶渡千劫
[03:33.472]只求 岁岁婵娟
[03:38.120]待到褪尽云烟
[03:41.888]飞花起舞在庭前
[03:45.560]浮灯朝月逐水间
[03:48.272]得见 昨日心中的月圆`,
  },
  {
    title: "玄翎谣",
    artist: "jkinss / 薄荷Miint",
    cover: '/music/covers/cover-9.jpg',
    audio: '/music/audio/song-9.mp3',
    note: "",
    lrc: `{"t":0,"c":[{"tx":"作词: "},{"tx":"冉语优","li":"http://p1.music.126.net/VTaVMTrMCzI8iEP_G4ojAA==/109951163596197517.jpg","or":"orpheus://nm/artist/home?id=34875386&type=artist"}]}
{"t":717,"c":[{"tx":"作曲: "},{"tx":"jkinss","li":"http://p1.music.126.net/pd6qh284zi4vsS44vLQeuA==/109951165321518435.jpg","or":"orpheus://nm/artist/home?id=36778576&type=artist"}]}
{"t":1434,"c":[{"tx":"编曲: "},{"tx":"jkinss","li":"http://p1.music.126.net/pd6qh284zi4vsS44vLQeuA==/109951165321518435.jpg","or":"orpheus://nm/artist/home?id=36778576&type=artist"}]}
{"t":2151,"c":[{"tx":"制作人: "},{"tx":"鸣潮先约电台"}]}
{"t":2868,"c":[{"tx":""}]}
{"t":3585,"c":[{"tx":"演唱 Vocal：薄荷Miint"}]}
{"t":4302,"c":[{"tx":"弦乐编写 String Composer：jkinss"}]}
{"t":5019,"c":[{"tx":"和声编写 Harmonic Arrangement：jkinss"}]}
{"t":5736,"c":[{"tx":"混音 Mixing Engineer：张步若@RSS Studio "}]}
{"t":6453,"c":[{"tx":"乐团 Orchestra：辉音国际爱乐乐团"}]}
{"t":7170,"c":[{"tx":"乐器独奏 Instrument Solo："}]}
{"t":7887,"c":[{"tx":" Guzheng：赵若言"}]}
{"t":8604,"c":[{"tx":" Pipa：袁端端"}]}
{"t":9321,"c":[{"tx":" Dizi：囚牛"}]}
{"t":10038,"c":[{"tx":" Violin：王温迪"}]}
{"t":10755,"c":[{"tx":" Cello：王偲翼"}]}
{"t":11472,"c":[{"tx":" Choir：詹文博 / 刘茗 / 陈芷茵 / 王语暄 / 郑培新（一百）/ 刘旺旺@合不拢嘴和音团"}]}
{"t":12189,"c":[{"tx":"指挥 Conductor：刘辉"}]}
{"t":12906,"c":[{"tx":"录音棚 Studio：48K Studio / 北京魔笛音乐录音棚 / 中国剧院录音棚 / 牛牛爸爸家"}]}
{"t":13623,"c":[{"tx":"录音师 Recording Engineer：高暐翔 Emo Kao / 坎瞳 / 李巍 / 王鑫"}]}
{"t":14340,"c":[{"tx":"监制 Music Supervisor：jixwang"}]}
{"t":15057,"c":[{"tx":"母带工程 Mastering Engineer：张步若@RSS Studio "}]}
{"t":15774,"c":[{"tx":"助理 Assistant：markmilian / 猫虚Sonn / auburn"}]}
{"t":16491,"c":[{"tx":"谱务 Scoring：auburn / Sakuma遙"}]}
{"t":17208,"c":[{"tx":"出品 Produced by：鸣潮先约电台"}]}
[00:17.934]玄翎飞，飞过江
[00:27.263]水泱泱，山茫茫
[00:36.019]明月光，月光照着影子长
[00:43.237]海内兮传四方，唤伊莫相忘
[00:52.583]玄翎飞，飞断肠
[01:01.254]天苍苍，地莽莽
[01:09.981]明月光（明月光，千里长，亦往）
[01:13.806]悠悠夜凉（湿衣裳，磨刀枪）
[01:18.173]海内兮传四方
[01:21.748]唤阿爹阿娘 千万莫相望
[01:27.503]潮水滔滔
[01:31.903]迷雾遮道
[01:36.179]前路迢迢
[01:40.629]归期遥遥
[01:44.925]荒山萧萧
[01:49.270]河无梁
[01:53.587]家酒难尝
[01:57.973]发染雪霜
[02:02.357]唤翎鸟，勿望 勿忘
[02:10.699]魂魄荡 长风长
[02:14.099]待到秋夜凉 送我回故乡
[02:47.173]（玄翎飞，飞断肠
[02:54.925]天苍苍，地莽莽）
[03:03.549]明月光（明月光，千里长，亦往）
[03:07.654]悠悠夜凉（湿衣裳，磨刀枪）
[03:11.646]海内兮传四方
[03:15.275]唤阿爷阿娘 千万莫相望
[03:20.867]潮水滔滔
[03:25.355]迷雾遮道
[03:29.549]前路迢迢
[03:33.747]归期遥遥
[03:38.269]荒山萧萧
[03:42.693]河无梁
[03:46.883]家酒难尝
[03:51.205]发染雪霜
[03:55.877]唤翎鸟，勿望 勿忘
[04:04.941]魂魄荡 长风长
[04:07.621]待到秋夜凉 送我回故乡
[04:15.645]（玄翎飞，飞断肠
[04:22.101]天苍苍，地莽莽）`,
  },
  {
    title: "小小奇迹",
    artist: "jixwang / 飞行雪绒",
    cover: '/music/covers/cover-10.jpg',
    audio: '/music/audio/song-10.mp3',
    note: "",
    lrc: `{"t":0,"c":[{"tx":"作曲 Composer: "},{"tx":"jixwang"}]}
{"t":1000,"c":[{"tx":"编曲 Arranger: "},{"tx":"jixwang"}]}
{"t":2000,"c":[{"tx":"作词 Lyricist: "},{"tx":"Xulai"}]}
{"t":3000,"c":[{"tx":"演唱 Vocal: "},{"tx":"飞行雪绒"}]}
{"t":4000,"c":[{"tx":"和声编写 Voicing Arrangement: "},{"tx":"jixwang"}]}
{"t":5000,"c":[{"tx":"混音 Mixing Engineer: "},{"tx":"Mitsunori Aizawa"}]}
{"t":6000,"c":[{"tx":"乐器独奏 Instrument Solo：Guitar: "},{"tx":"愤怒的糖"}]}
{"t":7000,"c":[{"tx":"飞行雪绒粉丝合音团 Fleet Snowfluff Choir Club: "},{"tx":"jixwang"},{"tx":"/"},{"tx":"baitian"},{"tx":"/"},{"tx":"jkinss"},{"tx":"/"},{"tx":"Minase"},{"tx":"/"},{"tx":"Koimoon"},{"tx":"/"},{"tx":"Ream雨舒"},{"tx":"/"},{"tx":"TLK天翔"},{"tx":"/"},{"tx":"YouZi"},{"tx":"/"},{"tx":"syjust"}]}
{"t":8000,"c":[{"tx":"录音棚 Studio: "},{"tx":"无音区杜比全景声棚"}]}
{"t":9000,"c":[{"tx":"录音师 Recording Engineer: "},{"tx":"Koimoon"}]}
{"t":10000,"c":[{"tx":"录音监督 Recording Producer: "},{"tx":"jixwang"},{"tx":"/"},{"tx":"markmilian"},{"tx":"/"},{"tx":"盖盖Nyan @再定义Studio"},{"tx":"/"},{"tx":"无糖宁宁子 @再定义Studio"}]}
{"t":11000,"c":[{"tx":"监制 Music Supervisor: "},{"tx":"jixwang"}]}
{"t":12000,"c":[{"tx":"母带工程 Mastering Engineer: "},{"tx":"Mitsunori Aizawa"}]}
{"t":13000,"c":[{"tx":"助理 Assistant: "},{"tx":"markmilian"},{"tx":"/"},{"tx":"Ream雨舒"},{"tx":"/"},{"tx":"TLK天翔"},{"tx":"/"},{"tx":"auburn"}]}
{"t":14000,"c":[{"tx":"出品 Produced by: "},{"tx":"鸣潮先约电台"}]}
[00:21.930]Isn't it so incredible
[00:26.820]We're here sharing the same time and space
[00:32.762]In your eyes, the sparks look like
[00:37.181]thousands of bright stars I have gazed at for thousands of time
[00:43.285]May all your sweet dreams take flight
[00:45.909]With the truth to be your guiding light
[00:48.917]Let your curiosity set your spirit free and wild like fire
[00:54.066]If the lonely nights are price to see
[00:56.654]Our dreams glowing brightly
[00:59.105]Every second is worth it
[01:03.382]You built a world of miracles so mundane but precious
[01:09.117]The stream of shimmering daily moments returned weight to my soul
[01:14.079]And stopped me from drifting
[01:16.171]Gave my feet the solid ground to stand
[01:18.795]So let's sing together
[01:20.449]Every light I'm giving all comes back to you
[01:24.173]comes back to you
[01:46.720]Like diamonds, they need a light to shine
[01:52.277]I was a shadow until you looked my way
[01:57.914]The rainbows I held inside
[02:02.521]Got kissed by sunshine now they can fly in the flowery skies
[02:08.745]Rhythms were beating in my heart
[02:11.479]Tunes were ringing in my ears non-stop
[02:13.903]That moment I found you
[02:16.426]They turned into a song that I could sing out
[02:19.347]If it takes all those lonely nights
[02:22.146]Just to see you smile tonight
[02:24.767]Then it's all been worth it
[02:29.147]You built a world of miracles so mundane but precious
[02:34.380]The stream of shimmering daily moments returned weight to my soul
[02:39.627]And stopped me from drifting
[02:41.507]Gave my feet the solid ground to stand
[02:44.028]So let's sing together
[02:45.788]Every light I'm giving all comes back to you
[02:49.413]comes back to you
[03:00.979]You built a world of miracles so mundane but precious
[03:06.207]The stream of shimmering daily moments returned weight to my soul
[03:11.611]And stopped me from drifting
[03:13.450]Gave my feet the solid ground to stand
[03:16.001]So let's sing together
[03:17.775]Every light I'm giving all comes back to you
[03:21.346]comes back to you
[03:24.340]（lalala,lalala,lalala,lalala)`,
  },
  {
    title: "那颗星梦见的春日",
    artist: "jixwang / 小林未郁",
    cover: '/music/covers/cover-11.jpg',
    audio: '/music/audio/song-11.mp3',
    note: "",
    lrc: `{"t":0,"c":[{"tx":"作曲 Composer: "},{"tx":"jixwang"}]}
{"t":754,"c":[{"tx":"编曲 Arranger: "},{"tx":"jixwang"}]}
{"t":1508,"c":[{"tx":"作词 Lyricist: "},{"tx":"Xulai"}]}
{"t":2262,"c":[{"tx":"演唱 Vocal: "},{"tx":"小林未郁"}]}
{"t":3016,"c":[{"tx":"和声编写 Voicing Arrangement: "},{"tx":"jixwang"}]}
{"t":3770,"c":[{"tx":"混音 Mixing Engineer: "},{"tx":"Mitsunori Aizawa"}]}
{"t":4524,"c":[{"tx":"乐团 Orchestra: "},{"tx":"The Great Brilliant Sound Orchestra 辉音国际爱乐乐团"}]}
{"t":5278,"c":[{"tx":"乐器独奏 Instrument Solo：Guitar: "},{"tx":"愤怒的糖"},{"tx":"/"},{"tx":"jixwang"}]}
{"t":6032,"c":[{"tx":"指挥 Conductor: "},{"tx":"刘辉"}]}
{"t":6786,"c":[{"tx":"录音棚 Studio: "},{"tx":"中国剧院录音棚"}]}
{"t":7540,"c":[{"tx":"录音师 Recording Engineer: "},{"tx":"李巍"}]}
{"t":8294,"c":[{"tx":"录音监督 Recording Producer: "},{"tx":"jixwang"},{"tx":"/"},{"tx":"markmilian"},{"tx":"/"},{"tx":"盖盖Nyan @再定义Studio"},{"tx":"/"},{"tx":"无糖宁宁子 @再定义Studio"}]}
{"t":9048,"c":[{"tx":"监制 Music Supervisor: "},{"tx":"jixwang"}]}
{"t":9802,"c":[{"tx":"母带工程 Mastering Engineer: "},{"tx":"Mitsunori Aizawa"}]}
{"t":10556,"c":[{"tx":"助理 Assistant: "},{"tx":"markmilian"},{"tx":"/"},{"tx":"Ream雨舒"},{"tx":"/"},{"tx":"TLK天翔"},{"tx":"/"},{"tx":"auburn"}]}
{"t":11310,"c":[{"tx":"谱务 Scoring: "},{"tx":"auburn"}]}
{"t":12064,"c":[{"tx":"出品 Produced by: "},{"tx":"鸣潮先约电台"}]}
[00:12.828]A fresh wash of sunlight
[00:14.615]Spreads over the grass and windowpanes
[00:17.489]When the last wisp of smoke dissolves in the lake
[00:21.729]As if nothing has changed
[00:23.604]Those black and white turn into colors on
[00:26.035]every piece of petal now softly gleaming
[00:29.045]Found myself whispering your name as one touched my skin
[00:34.414]I see time finally shed its chains
[00:38.659]Flying free like a paper plane
[00:41.708]in this common start of day
[00:45.196]This is the world you fought for
[00:49.927]All things unfold and extend in order as they did before
[00:56.169]This is the spark you have guarded
[01:00.949]with both your hands and all your strength
[01:04.067]through nightmares to the break of dawn
[01:09.349]The frozen pulse of life
[01:15.339]now beats again
[01:20.102]The breeze is singing your faith
[01:26.175]Across the vibrant plain
[01:32.647]When the mortality
[01:34.756]Echoed between you and the abyss
[01:37.323]Like a twisted and crescendo finale
[01:41.614]Not once did you ever flinch
[01:43.568]You chose the alternative narritive
[01:46.157]Stare at the tragedy, raising your voice
[01:49.085]Sing the lament out loud like a battle song
[01:52.076]On the way to starting point
[01:54.532]I see spring profusely waking green
[01:58.782]Along the paper plane's trace
[02:01.929]in this common start of day
[02:05.173]This is the world you fought for
[02:09.925]All things unfold and extend in order as they did before
[02:16.104]This is the spark you have guarded
[02:20.866]with both your hands and all your strength
[02:24.165]through nightmares to the break of dawn
[02:29.196]The frozen pulse of life
[02:35.239]now beats again
[02:40.093]The breeze is singing your faith
[02:45.784]Across the vibrant plain
[02:49.430]Paper planes are flying faraway
[02:53.886]Wish they could fly across the space
[02:56.818]Gently land on your palm and tell you
[03:00.378]This is the world you fought for
[03:04.935]All things unfold and extend in order as they did before
[03:11.315]This is the spark you have guarded
[03:15.911]with both your hands and all your strength
[03:19.204]through nightmares to the break of dawn
[03:24.833](Hopes)The frozen pulse of life(bloom)
[03:30.476]now beats again(in)
[03:35.272]The breeze is singing your faith(your dream)
[03:41.219]Across the vibrant plain`,
  },
  {
    title: "纸飞机",
    artist: "飞行雪绒",
    cover: '/music/covers/cover-12.jpg',
    audio: '/music/audio/song-12.mp3',
    note: "",
    lrc: `{"t":0,"c":[{"tx":"出品: "},{"tx":"鸣潮先约电台"}]}
{"t":1000,"c":[{"tx":"演唱: "},{"tx":"飞行雪绒"}]}
{"t":2000,"c":[{"tx":"音乐制作人: "},{"tx":"Haruno"}]}
{"t":3000,"c":[{"tx":"作曲: "},{"tx":"Haruno"}]}
{"t":4000,"c":[{"tx":"作词: "},{"tx":"David Lin"}]}
{"t":5000,"c":[{"tx":"编曲: "},{"tx":"Haruno"}]}
{"t":6000,"c":[{"tx":"弦乐编写: "},{"tx":"Haruno"},{"tx":"/"},{"tx":"Qutabire"}]}
{"t":7000,"c":[{"tx":"配唱制作: "},{"tx":"Haruno"},{"tx":"/"},{"tx":"kahoca (Empty old City)"}]}
{"t":8000,"c":[{"tx":"录音工程师: "},{"tx":"Junichiro ojjy Ojima (FREEDOM STUDIO INFINITY)"}]}
{"t":9000,"c":[{"tx":"人声修音: "},{"tx":"欧阳嘉豪 (sof.)"}]}
{"t":10000,"c":[{"tx":"混音/母带: "},{"tx":"Tune Lee"}]}
{"t":11000,"c":[{"tx":"音乐监制: "},{"tx":"Steven Tang"},{"tx":"/"},{"tx":"SmileL"},{"tx":"/"},{"tx":"沐可linda"},{"tx":"/"},{"tx":"Grass"}]}
[00:30.359]It's magic when snowflakes could cling
[00:36.595]Like powdered stardust on your skin, glistening
[00:43.142]Their moments may be fleet and paper thin
[00:48.785]But through your voyage they will sing
[00:53.272]Soaring like the paper plane we dreamed
[00:59.733]Coasting through the trails we paved
[01:04.112]It’s not make believe
[01:06.202]Fly 'til frost turns to spring
[01:09.845]Carry the torch for me and spread your wings
[01:14.465]I will cast a glow up from your sky
[01:18.999]Your ever-guiding light
[01:25.603]Names of greats that make history
[01:31.670]Cave in time to fadeaway memories
[01:36.767]But I won't let it faze me
[01:40.538]Cause I don't pine for what's to be of me
[01:45.611]"Up in the air"
[01:47.074]Isn't "nowhere"
[01:49.650]So there's no floating 'round aimlessly
[01:52.900]Look on up and you'll see
[01:56.319]It grows, and grows, and most of all
[01:59.634]So alive and bursting with
[02:03.153]Colors all blossoming
[02:05.879]What the plan's been promising
[02:08.790]The end's another new beginning ahead
[02:21.029]Did I catch a twinkle in your eye?
[02:27.476]Did they really mirror mine?
[02:31.713]I wanna believe
[02:34.866]It's what keeps my wish afloat
[02:41.441]I hope you know
[02:46.880]Soaring like the paper plane we dreamed
[02:53.322]Coasting through the trails we paved
[02:57.607]It's not make believe
[02:59.732]Fly 'til frost turns to spring
[03:03.431]Carry the torch for me and spread your wings
[03:08.941]I will cast a glow up from your sky
[03:12.514]Your ever-guiding light
[03:18.204]Ooh`,
  },
  {
    title: "远航星的告别",
    artist: "jixwang / Tarokiki / Emi Evans",
    cover: '/music/covers/cover-13.jpg',
    audio: '/music/audio/song-13.mp3',
    note: "",
    lrc: `{"t":0,"c":[{"tx":"作曲 Composer: "},{"tx":"jixwang"}]}
{"t":1000,"c":[{"tx":"编曲 Arranger: "},{"tx":"jixwang"}]}
{"t":2000,"c":[{"tx":"作词 Lyricist: "},{"tx":"Xulai"}]}
{"t":3000,"c":[{"tx":"演唱 Vocal: "},{"tx":"Tarokiki"},{"tx":"/"},{"tx":"Emi Evans"}]}
{"t":4000,"c":[{"tx":"和声编写 Voicing Arrangement: "},{"tx":"jixwang"}]}
{"t":5000,"c":[{"tx":"混音 Mixing Engineer: "},{"tx":"Mitsunori Aizawa"}]}
{"t":6000,"c":[{"tx":"乐器独奏 Instrument Solo：Guitar: "},{"tx":"愤怒的糖"}]}
{"t":7000,"c":[{"tx":"录音监督 Recording Producer: "},{"tx":"jixwang"},{"tx":"/"},{"tx":"markmilian"},{"tx":"/"},{"tx":"盖盖Nyan @再定义Studio"},{"tx":"/"},{"tx":"无糖宁宁子 @再定义Studio"}]}
{"t":8000,"c":[{"tx":"监制 Music Supervisor: "},{"tx":"jixwang"}]}
{"t":9000,"c":[{"tx":"母带工程 Mastering Engineer: "},{"tx":"Mitsunori Aizawa"}]}
{"t":10000,"c":[{"tx":"助理 Assistant: "},{"tx":"markmilian"},{"tx":"/"},{"tx":"Ream雨舒"},{"tx":"/"},{"tx":"TLK天翔"},{"tx":"/"},{"tx":"auburn"}]}
{"t":11000,"c":[{"tx":"出品 Produced by: "},{"tx":"鸣潮先约电台"}]}
[00:23.339]That snowflake once fell on my nose
[00:28.385]now flying backwards to last winter
[00:34.597]I realize that hellos are goodbyes
[00:39.707]The moment I softly let go of your hand
[00:46.145]Winds hum through the trembling branches
[00:51.118]A song for a soul bound to soar to
[00:54.672]The very edge of the starry ocean
[00:57.623]Even if we're meant to fall apart
[01:02.467]I will gaze at where you are for all time
[01:07.614]Bon voyage
[01:10.441]May your path be clear
[01:13.280]May you get to where dreams are all crystalline and sweet
[01:20.412]Please crack a little smile
[01:24.730]You won't be alone
[01:27.337]In this world you've chosen as your own
[01:31.921]Don't worry
[01:33.886]I'm well aware that all snowflakes melt in the end
[01:43.271]Which is sign of warmth and hope of spring
[01:47.958]So I'll dance flamboyantly into that good night
[02:04.741]Bon voyage
[02:07.595]May your path be clear
[02:10.385]May you get to where dreams are all crystalline and sweet
[02:17.597]Please crack a little smile
[02:21.888]You won't be alone
[02:24.501]In this world you've chosen as your own
[02:29.120]Timing is such a dazzling riddle
[02:34.699]Guess I'll spend my whole life unraveling it
[02:40.469]Though it might cost me everything I have
[02:46.114]I never regret it, wouldn't have it any other way cuz
[02:51.922]Those who trace starlight on their lonely roads
[02:57.507]Will find their destinations in the cosmos
[03:03.284]Meeting you in that swirling snowfall's
[03:08.841]the most beautiful thing ever happened to me`,
  },
];
