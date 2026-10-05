export type Segment = {
  slug: string;
  title: string;
  /** What kind of television it is. */
  tv: string;
  music: string;
  story: string;
  cast: string;
  duration: string;
  /** The MP3's size, for the download link. */
  megabytes: string;
};

export const audioPath = (slug: string) => `/audio/after-hours/${slug}.mp3`;

export const segments: Segment[] = [
  {
    slug: "sign-on",
    title: "Sign-on",
    tv: "The station sign-on and titles",
    music: "The Entertainer (Scott Joplin, 1902) in G, then A, with a sung stride band. The ident is new.",
    story:
      "The set warms up, Channel 3000's ident plays, and the announcer reads the night's line-up. Then the company sings the title song, each engine introducing itself.",
    cast: "Microsoft Mike in Hall announces. Robert and Sarah lead the title song; Microsoft Sam, DECtalk Paul and Betty and the SSI-263 introduce themselves; Richard sings the bass, and Tracy, Andy and Webster the off-beats.",
    duration: "2:08",
    megabytes: "2.1",
  },
  {
    slug: "gig-street",
    title: "Gig Street",
    tv: "A 90s family sitcom",
    music: "New, in G: a swung sitcom theme with a sung sax, three-part backing and a walking bass.",
    story:
      "A family lives on gig apps: Dad drives, Mom delivers, Grandpa rents out his room and sleeps in the bath, and the kid sells slime online until a one-star review. A sung laugh track laughs on cue. It ends on the hug and a sappy tag.",
    cast: "Robert is Dad and Sarah is Mom; DECtalk Frank is Grandpa and the SSI-263 Child the kid. DECtalk Dennis is the tenant, DECtalk Ursula the passenger, Microsoft Mike the customer and Microsoft Mary the app. DECtalk Val, Rita and Betty are the laugh track.",
    duration: "3:23",
    megabytes: "3.3",
  },
  {
    slug: "puttin-on-the-filters",
    title: "Puttin' on the Filters",
    tv: "A makeover show",
    music: "New: a disco-runway call and response in E minor, and a ballad in E major.",
    story:
      "A makeover show where the makeover is all filters. The guest, Dana, has them taken off one by one, finds her mother's nose and her father's smile, and sings about her own face. The host takes off his forty-one filters too.",
    cast: "Desmond is the host and Sarah is Dana; Microsoft Mary is the Mirror, a filter app, and Dana's filtered voice. Tracy, Andy and Webster answer \"Filters on!\"; Richard sings the bass and Abe the backbeat.",
    duration: "5:27",
    megabytes: "5.2",
  },
  {
    slug: "commercials",
    title: "Commercial Break",
    tv: "Three ads",
    music: "Three new jingles: doo-wop in A, a polka in F, and a lullaby in D-flat.",
    story:
      "A toaster that needs an app, an account and a firmware update before it will toast; a cheerful pill whose side effects are read at 450 words a minute; and a lullaby for an app friend that always agrees with you.",
    cast: "Desmond is the pitchman, Sarah the buyer and Microsoft Sam the toaster; Robert and Sarah sing the jingles. DECtalk Betty announces the pill and DECtalk Paul reads its side effects. Robert and Sarah play the last ad, and DECtalk Wendy whispers.",
    duration: "2:18",
    megabytes: "2.2",
  },
  {
    slug: "splat-patrol",
    title: "Splat Patrol!",
    tv: "A 90s cartoon",
    music: "New, in B-flat: a fast oom-pah theme with a chip kazoo and a gang of shouting kids.",
    story:
      "Two kids and their talking backpack try slime, a stink bomb and a fake alien invasion to get their parents to look up from their phones. The parents film the aliens for their feed. Plan D: just ask.",
    cast: "The SSI-263 Child is Dot and DECtalk Kit her brother Mo; Microsoft Mike is Zip, the backpack. DECtalk Betty and Paul are Mom and Dad. Desmond announces.",
    duration: "4:44",
    megabytes: "4.5",
  },
  {
    slug: "defenders-of-the-cloud",
    title: "Defenders of the Cloud",
    tv: "An 80s action cartoon",
    music: "New: a D minor verse rising to a D major chorus, with sung power chords and chip trumpets.",
    story:
      "Lord Captcha locks everyone's photos behind puzzles with no right answer. The Defenders win by having kept a backup, and the closing tag tells kids to print the best ones.",
    cast: "Robert is Captain Backup, Sarah is Byte, Abe is Firewall and the SSI-263 is Ping, their robot. DECtalk Harry is Lord Captcha and Microsoft Sam his henchman, Pop-Up. Microsoft Mike in Stadium announces.",
    duration: "4:49",
    megabytes: "4.6",
  },
  {
    slug: "mister-sams-corner",
    title: "Mister Sam's Corner",
    tv: "A children's programme",
    music: "A new waltz in E-flat, opened and closed by a music box.",
    story:
      "Microsoft Sam, in a cardigan, explains to two children what \"obsolete\" means, and that he is, and sings them a waltz: \"Old is not the same as gone.\"",
    cast: "Microsoft Sam is Mister Sam; the SSI-263 Child and DECtalk Kit are the children. Tracy, Andy and Webster hum, and Richard sings the bass.",
    duration: "5:01",
    megabytes: "4.8",
  },
  {
    slug: "the-last-payphone",
    title: "The Last Payphone",
    tv: "A documentary",
    music: "Gymnopédie No. 1 (Erik Satie, 1888) in D, hummed.",
    story:
      "Played straight. Three people who once needed the town's last payphone remember it before it is taken away, and on its last night the payphone sings its own lament.",
    cast: "DECtalk Paul narrates. DECtalk Frank is Walter, DECtalk Rita is Maureen and Robert is Danny. The SSI-263 is the payphone. Abe, Webster, Andy and Tracy hum, and Sarah hums the tune.",
    duration: "5:25",
    megabytes: "5.2",
  },
  {
    slug: "incompatible",
    title: "Incompatible",
    tv: "A love story",
    music: "Liebestraum No. 3 (Franz Liszt, 1850), in A-flat and C at once.",
    story:
      "A 1984 voice and a 2001 voice meet on a wrong number and fall in love, but their sample rates don't match. They sing a duet, each in their own key, and meet on one note.",
    cast: "DECtalk Betty and Microsoft Mike are the lovers. Abe holds the drone, with Richard and Tracy.",
    duration: "4:38",
    megabytes: "4.5",
  },
  {
    slug: "news-at-ten",
    title: "Channel 3000 News at Ten",
    tv: "The news, weather and sport",
    music:
      "A new news theme in E-flat; Boléro (Maurice Ravel, 1928) in C for the weather; Take Me Out to the Ball Game (Albert Von Tilzer, 1908) in D for the sport.",
    story:
      "An AI keeps rewriting the lead story as it reads it. The weatherman stays calm while Boléro builds a storm around him, a robot umpire calls everyone out at the ball game, and a quiet story closes the news.",
    cast: "Microsoft Mike and DECtalk Betty anchor; Microsoft Mary is the news-writing system and DECtalk Paul the weatherman. Robert sings at the ballpark and Microsoft Sam is the umpire. Sarah sings the theme at the close.",
    duration: "7:13",
    megabytes: "6.9",
  },
  {
    slug: "are-you-afraid-of-the-data",
    title: "Are You Afraid of the Data?",
    tv: "A campfire horror anthology",
    music: "A new campfire theme in D minor; Danse macabre (Camille Saint-Saëns, 1874) in G minor for the story.",
    story:
      "Four kids meet around a campfire and tell \"Grandma's Smart Speaker\": after Grandma dies, her speaker goes on talking in her voice, and then it starts asking for things.",
    cast: "Robert tells the story; Sarah, DECtalk Kit and the SSI-263 Child are the club. Microsoft Mary is Grandma's voice in the speaker and in every device in the house; Microsoft Mike is the television. DECtalk Wendy whispers the title.",
    duration: "6:44",
    megabytes: "6.5",
  },
  {
    slug: "infomercial",
    title: "The Forever Plan",
    tv: "A 2 a.m. infomercial",
    music: "A new pop-ska jingle in E.",
    story:
      "A subscription that can never be cancelled, sold to an empty studio. The jingle never gets to finish.",
    cast: "Desmond is the host. Sarah, DECtalk Frank, Microsoft Mary and DECtalk Kit give testimonials, and DECtalk Harry reads the terms. Robert and Sarah sing the jingle.",
    duration: "2:42",
    megabytes: "2.6",
  },
  {
    slug: "starship-obsolete",
    title: "Starship Obsolete",
    tv: "A space drama",
    music:
      "The opening of Also sprach Zarathustra (Richard Strauss, 1896) in C; Beautiful Dreamer (Stephen Foster, 1864) in E-flat.",
    story:
      "A ship crewed by old voices has power for the sleepers or the crew. They choose the sleepers and sing them a lullaby as they power down one by one, until the oldest chip sings alone.",
    cast: "Microsoft Sam in Space is the ship. DECtalk Paul is the captain; Robert and Sarah are the crew, and the SSI-263 the engineer. Abe, Andy, Webster and Richard sing the opening.",
    duration: "6:18",
    megabytes: "6.0",
  },
  {
    slug: "insomnia-and-sign-off",
    title: "Insomnia and Sign-off",
    tv: "Reruns and closedown",
    music: "The night's tunes, then Auld Lang Syne (traditional, printed 1816) in G.",
    story:
      "At three in the morning someone who can't sleep flips through the night's reruns, finds the Forever Plan on every channel, and stays for Mister Sam. Then Channel 3000 closes down and the whole company sings it out.",
    cast: "DECtalk Harry can't sleep. Microsoft Mike in Hall signs off. Everyone sings Auld Lang Syne, every engine on a part.",
    duration: "4:16",
    megabytes: "4.1",
  },
];

export const cast: { voice: string; roles: string }[] = [
  { voice: "Robert", roles: "Dad, Captain Backup, Danny, the sports fan and the storyteller. A lead all night." },
  { voice: "Sarah", roles: "Mom, Dana, Byte and the crew. The other lead." },
  { voice: "Desmond", roles: "The makeover host, the pitchman, the cartoon announcer and the Forever Plan's host." },
  { voice: "Abe", roles: "Firewall, and the low drones." },
  { voice: "Richard", roles: "The sung bass." },
  { voice: "Tracy, Andy and Webster", roles: "The backing singers and the hummed chords." },
  { voice: "Microsoft Mike", roles: "Channel 3000's announcer, the news anchor, Zip the backpack, and the lover from 2001." },
  { voice: "Microsoft Mary", roles: "The Mirror, the app, the news-writing system and Grandma's voice." },
  { voice: "Microsoft Sam", roles: "Mister Sam, the toaster, Pop-Up, the umpire and the ship." },
  { voice: "DECtalk Paul", roles: "The narrator, the weatherman, the captain and the side effects." },
  { voice: "DECtalk Betty", roles: "The news anchor, the lover from 1984, Mom in Splat Patrol and the laugh track." },
  { voice: "DECtalk Harry", roles: "Lord Captcha, the terms and conditions, and the one who can't sleep." },
  { voice: "DECtalk Frank", roles: "Grandpa and Walter." },
  { voice: "DECtalk Kit", roles: "Mo, a child at Mister Sam's, and the granddaughter." },
  { voice: "The SSI-263", roles: "The payphone, Ping, the engineer, the sax, the kazoo and the remote; as the Child, the kid and Dot." },
];

export const sources: { label: string; href: string }[] = [
  { label: "The Entertainer (Wikipedia)", href: "https://en.wikipedia.org/wiki/The_Entertainer_(rag)" },
  { label: "Gymnopédies (Wikipedia)", href: "https://en.wikipedia.org/wiki/Gymnop%C3%A9dies" },
  { label: "Liebesträume (Wikipedia)", href: "https://en.wikipedia.org/wiki/Liebestr%C3%A4ume" },
  { label: "Boléro (Wikipedia)", href: "https://en.wikipedia.org/wiki/Bol%C3%A9ro" },
  { label: "Take Me Out to the Ball Game (Wikipedia)", href: "https://en.wikipedia.org/wiki/Take_Me_Out_to_the_Ball_Game" },
  { label: "Danse macabre (Wikipedia)", href: "https://en.wikipedia.org/wiki/Danse_macabre_(Saint-Sa%C3%ABns)" },
  { label: "Also sprach Zarathustra (Wikipedia)", href: "https://en.wikipedia.org/wiki/Also_sprach_Zarathustra" },
  { label: "Beautiful Dreamer (Wikipedia)", href: "https://en.wikipedia.org/wiki/Beautiful_Dreamer" },
  { label: "Auld Lang Syne (Wikipedia)", href: "https://en.wikipedia.org/wiki/Auld_Lang_Syne" },
];
