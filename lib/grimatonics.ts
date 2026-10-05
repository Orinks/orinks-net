export type GrimSong = {
  slug: string;
  title: string;
  origin: string;
  /** One line: what the song is about now. */
  tagline: string;
  tune: string;
  onRecord: string;
  folklore: string;
  modern: string;
  trivia: string[];
  singers: string;
  duration: string;
  /** The MP3's size, for the download link. */
  megabytes: string;
};

export const audioPath = (slug: string) => `/audio/grimatonics/${slug}.mp3`;

export const songs: GrimSong[] = [
  {
    slug: "baa-baa-black-sheep",
    title: "Baa Baa Black Sheep (Five Stars)",
    origin: "England",
    tagline: "The platform takes its cut.",
    tune: 'The Twinkle Twinkle tune, "Ah! vous dirai-je, maman" (1761), in C minor, with the app\'s jingle in major.',
    onRecord:
      'First printed in London in 1744, where all three bags are given away. By about 1765 a new ending appears: "But none for the little boy who cries in the lane", printed above a moral: "Bad habits are easier conquered to-day than to-morrow."',
    folklore:
      "That the three bags are a medieval wool tax, a third each to king and church, dates from 1930 and has no evidence. A real wool export tax began in 1275, but it was a flat fee per sack. The 1980s \"ban\" on the rhyme was largely a tabloid invention.",
    modern:
      "The sheep is the gig worker: a bag for the app, a bag for the algorithm, five stars, and less each year for the one who did the shearing.",
    trivia: [
      "The oldest known recording of computer music is a Ferranti Mark 1 in Manchester playing this tune, recorded by the BBC in 1951.",
      '"Yes sir, yes sir, three bags full, sir" has meant a grovelling underling since at least 1910.',
    ],
    singers:
      "Robert leads; Sarah is the driver, Abe the master and Desmond the app; Richard sings the bass; Tracy, Andy and Webster hum.",
    duration: "2:54",
    megabytes: "2.8",
  },
  {
    slug: "pop-goes-the-weasel",
    title: "Pop Goes the Weasel (Payday)",
    origin: "England",
    tagline: "Pawn it on Monday, buy it back on payday.",
    tune: "The 1850s dance tune, in C minor, 6/8.",
    onRecord:
      'A dance-tune craze in 1850s London; the City Road verse was in print by 1856. The Eagle was a real pub on City Road, rebuilt as a music hall in 1825, and "pop" was slang for pawning something.',
    folklore:
      'Nobody knows what the "weasel" was. A tailor\'s iron and rhyming slang for a coat ("weasel and stoat") are the usual guesses.',
    modern:
      "The weekly pawn-and-redeem cycle never went away: it is the payday loan and the buy-now-pay-later app.",
    trivia: ["It is the tune most jack-in-the-box toys play before the lid pops open."],
    singers:
      "Robert and Sarah lead, Abe is the pawnbroker and Desmond the app; Richard sings the bass; Tracy, Andy and Webster hum.",
    duration: "2:25",
    megabytes: "2.3",
  },
  {
    slug: "london-bridge",
    title: "London Bridge (The Toll)",
    origin: "England",
    tagline: "Who will pay when the concrete cracks?",
    tune: "The traditional tune, in E minor, as a slow dance in 3/4.",
    onRecord:
      "The stone bridge stood from 1209 on 19 arches, with houses on it. In 1269 Henry III gave its income to Queen Eleanor; in the winter of 1281 ice took out five arches, and in 1282 the City set up a trust so the tolls paid for repairs. Traitors' heads were boiled, tarred and set over its gate from 1305 to 1661.",
    folklore:
      'Nothing backs the stories that the "fair lady" is Queen Eleanor (the oldest text, from 1744, says "Dance over my Lady Lee"), that a child was walled into the foundations (no remains were ever found), or that the rhyme recalls a Viking attack in 1014 (a translator borrowed the nursery line in 1844).',
    modern: "Shareholders take the toll, the dividends go up and up, and nobody pays when the concrete cracks.",
    trivia: [
      "In 1968 the 1831 bridge was sold to Robert McCulloch and rebuilt at Lake Havasu City, Arizona. The story that he thought he was buying Tower Bridge is false.",
      '"London Bridge is down" was the code phrase for the death of Queen Elizabeth II.',
    ],
    singers:
      "Robert leads; Andy calls each line, and Desmond, Abe and Webster shout it back; Sarah is the lady; Abe and Richard sing the heads on the gate; Richard sings the falling bass.",
    duration: "3:08",
    megabytes: "3.0",
  },
  {
    slug: "wee-willie-winkie",
    title: "Wee Willie Winkie (Night Vision)",
    origin: "Scotland",
    tagline: "Always at the window.",
    tune: "A new tune in A Dorian, with Scottish short-long rhythms over a sung bagpipe drone.",
    onRecord:
      'William Miller, a Glasgow woodturner, published it in Scots in 1841: Willie runs through the town in his nightgown, "tirlin\' at the window, cryin\' at the lock". The first verse is older, from about 1820. Miller died poor in 1872, in an unmarked grave; a later monument called him "The Laureate of the Nursery".',
    folklore:
      '"Willie Winkie" was a nickname for King William III, but nothing ties the rhyme to him.',
    modern: "The watcher at the window is now a doorbell camera or a glass eye in the night-light, and a stranger's voice comes through the speaker.",
    trivia: [
      "Rudyard Kipling used the name for a story in 1888, and Shirley Temple starred in the 1937 film.",
    ],
    singers:
      "Robert leads; Sarah and Webster add harmony, then Andy; Richard and Abe hold the drone; Desmond knocks.",
    duration: "2:27",
    megabytes: "2.3",
  },
  {
    slug: "sing-a-song-of-sixpence",
    title: "Sing a Song of Sixpence (Cost of Doing Business)",
    origin: "England",
    tagline: "The king counts; the maid bleeds.",
    tune: "The traditional British tune, sung as a barbershop quartet in F.",
    onRecord:
      'The first printing, in 1744, bakes "four and twenty naughty boys" in the pie; blackbirds replace them by about 1780. In the oldest full text the maid\'s nose is bitten off by a magpie. Pies of live birds were real: a cookbook printed in English in 1598 explains how to make one so the birds fly out when it is cut.',
    folklore:
      "No evidence links it to Henry VIII and his wives, the 24 hours of the day, or a code for printing the Bible. The story that Blackbeard used the rhyme to recruit pirates was a hoax Snopes planted in 1999.",
    modern:
      "Fortunes are counted in billions while warehouses fill with machines. A worker's injury is filed as the cost of doing business.",
    trivia: [
      "Sixpence coins were minted from 1551 to 1980.",
      "A gentler verse, added in the 1800s, sends little Jenny Wren to put the maid's nose back on.",
    ],
    singers: "Robert sings the tune, Andy the tenor, Webster the baritone and Richard the bass; Sarah sings the 1744 ending alone.",
    duration: "2:13",
    megabytes: "2.1",
  },
  {
    slug: "the-old-woman-who-lived-in-a-shoe",
    title: "The Old Woman Who Lived in a Shoe (Temporary)",
    origin: "England",
    tagline: "One cramped room.",
    tune: "A new tune in D minor, sung in mono: every voice in the middle, in one room.",
    onRecord:
      'First printed in about 1784. A 1797 version has her knock the children on the head with a borrowed mallet and order coffins; a Scots version printed in 1843 finds them "a\' lying dead", then "a\' lying laughing".',
    folklore:
      'Nobody has shown that she is Queen Caroline or George II, or that the shoe is a fertility charm. "Mother Goose" as a real woman in Boston is a story from 1864.',
    modern: "Families live in single rooms and wait for cots that never come, and six weeks turn into a year.",
    trivia: [
      "Old shoes, many of them children's, have been found hidden in the walls and chimneys of old houses; one museum's index lists about 2,000.",
    ],
    singers: "Sarah is the mother; Tracy, Andy, Desmond and Webster are the children.",
    duration: "2:17",
    megabytes: "2.2",
  },
  {
    slug: "ring-a-ring-o-roses",
    title: "Ring a Ring o' Roses (Next Wave)",
    origin: "England",
    tagline: "We all fall down, and we forget.",
    tune: "The familiar playground chant, in D.",
    onRecord:
      'Its oldest relative is German, from 1796: three children sit under an elder bush and all go "husch". By 1883 the sneeze was already a game noise, and the "fall" was a curtsy.',
    folklore:
      "The plague reading is folklore about folklore: nobody linked the rhyme to the plague in print until after the Second World War, and its symptoms don't match.",
    modern: "A pandemic brings masks and lockdowns, then is quickly forgotten while the next outbreaks gather.",
    trivia: [
      'A 1949 parody ran "A pocket full of uranium, Hiro, shima, all fall down!"',
      "In 2020 it was suggested as a hand-washing song.",
    ],
    singers: "Everyone sings in unison; two voices leave after each verse until Robert is alone.",
    duration: "1:46",
    megabytes: "1.7",
  },
  {
    slug: "ladybird-ladybird",
    title: "Ladybird, Ladybird (Fire Season)",
    origin: "England",
    tagline: "Your house is on fire.",
    tune: 'Sung to "Schlaf, Kindlein, schlaf", the German lullaby (1781); the key climbs a half step every verse.',
    onRecord:
      'The first printing, in 1744, ends "Your Children will burn"; around 1780 a printer softened it to "are gone". A longer version from about 1840 saves little Ann, who hides under the warming-pan. The "Lady" is Our Lady, the Virgin Mary.',
    folklore: "There is no early evidence for farmers burning the hop fields with the ladybirds on them, or for Catholics hunted in Protestant England.",
    modern: "Wildfire takes the house, and the insurer is gone before the smoke. The children breathe it.",
    trivia: [
      "Iona and Peter Opie began their lifetime's work on nursery rhymes after one of them said this rhyme to a ladybird.",
      'Its German twin, "Maikäfer, flieg!", is sung to the same lullaby: "Father\'s at war, Pomerania\'s burned down."',
    ],
    singers: "Robert and Sarah, alone.",
    duration: "1:48",
    megabytes: "1.7",
  },
  {
    slug: "malbrough",
    title: "Malbrough (Next of Kin)",
    origin: "France and Spain",
    tagline: "He'll never come back.",
    tune: 'The tune of "For He\'s a Jolly Good Fellow", in F, as a march.',
    onRecord:
      'Malbrough is the Duke of Marlborough. The song surfaces in the 1760s: he goes to war, his lady climbs her tower, a page in black brings news of his burial, and everyone goes to bed, "some with their wives, and others alone". It became a craze after Marie Antoinette heard it in 1781.',
    folklore: "Two stories of how it began have no support: that a soldier made it up in 1709 when Marlborough was falsely reported dead, and that the tune came from the Crusades.",
    modern: "Soldiers still go to war and families still wait. Some of the dead come home without a name.",
    trivia: [
      "Beethoven used the tune for the French army in Wellington's Victory (1813).",
      'In America the same tune became "The Bear Went Over the Mountain".',
    ],
    singers:
      "Robert tells it, Abe is the page and Sarah the lady; Webster, Desmond, Andy, Abe and Richard roar the refrain; Desmond plays the drum.",
    duration: "1:44",
    megabytes: "1.7",
  },
  {
    slug: "brahms-lullaby",
    title: "Brahms' Lullaby (Shelter)",
    origin: "Germany",
    tagline: "If God wills, you'll wake again.",
    tune: "Brahms's own tune (1868), in E-flat.",
    onRecord:
      'The words are a folk rhyme printed in 1808: "tomorrow morning, if God wills, you will be woken again." Brahms set it for a friend, Bertha Faber, when her second son was born, and hid in the piano part a song she used to sing to him. The English most people sing, printed by 1886, drops "if God wills".',
    folklore: 'The idea that the line is about babies who died in the night is modern. In German it is an ordinary "God willing".',
    modern: "Children are put to bed in hallways and bathrooms while the sirens sound, under a sky where machines pick the targets.",
    trivia: ["It was first performed in Vienna in 1869, with Clara Schumann at the piano."],
    singers: "Sarah sings it, with Robert; Webster and Tracy hum; Andy and Desmond are the siren.",
    duration: "2:50",
    megabytes: "2.7",
  },
  {
    slug: "row-row-row-your-boat",
    title: "Row, Row, Row Your Boat (The Crossing)",
    origin: "USA",
    tagline: "Gently down the stream.",
    tune: "The 1881 tune, in D, ending as a round.",
    onRecord:
      'The words first appear in 1852, in a song from the blackface minstrel stage, to a different tune; its chorus went "All that\'s past is gone, you know, the future\'s but a dream." The tune and "Life is but a dream" first appear in 1881, set as a round.',
    folklore:
      'That the boat is the ferry of the dead, or the song a Buddhist teaching, is modern. The "river chilly and cold" verses online belong to a different song, "Michael, Row the Boat Ashore".',
    modern: "Small boats set out with too many aboard, and some never reach the shore.",
    trivia: [
      "The 1881 tune is credited to E. O. Lyte, who was ten years old in 1852.",
      'Lewis Carroll\'s 1871 poem drifts "down the stream" and asks "Life, what is it but a dream?"',
    ],
    singers: "Robert and Sarah sing the verses; Andy and Webster join the round; Richard rows.",
    duration: "1:59",
    megabytes: "1.9",
  },
  {
    slug: "oranges-and-lemons",
    title: "Oranges and Lemons (Final Notice)",
    origin: "England",
    tagline: "The bells call in the debts.",
    tune: "The traditional tune and bass line (Walter Crane, 1877), in A.",
    onRecord:
      "The first printing, around 1744, is a list of London bells and their sayings, with no candle and no chopper; those lines appear about a hundred years later. In 1605 Robert Dowe paid for a bellman at St Sepulchre's, opposite Newgate prison, to ring a handbell outside the condemned cell at midnight and recite a verse. The handbell is still in the church.",
    folklore:
      "The churches don't mark the road to the gallows (they're in the wrong direction), and nothing ties it to Henry VIII's wives. Debtors were jailed, not hanged.",
    modern: "The bells ring for bailiffs, letters and arrears, then for long days in jail and the midnights the state still keeps.",
    trivia: [
      "George Orwell wove this rhyme through Nineteen Eighty-Four.",
      "Children at St Clement Danes are still given an orange and a lemon at an annual service.",
    ],
    singers:
      "Robert leads, with Sarah and Webster at the end; five singers ring the bells; Richard sings the bass bell and Abe tolls; a whisper reads the bellman's verse; Tracy and Andy chant.",
    duration: "1:55",
    megabytes: "1.8",
  },
  {
    slug: "who-killed-cock-robin",
    title: "Who Killed Cock Robin (Many Hands)",
    origin: "England",
    tagline: "The rest got away.",
    tune: "A new tune in B minor.",
    onRecord:
      'The first four verses were printed in 1744, and the whole funeral by about 1770. A fragment, "I saw a sparrow shoot an arrow", survives from the 1400s. An early-1800s chapbook puts the Sparrow on trial and ends: "The rest got away."',
    folklore: "Readings about the fall of Robert Walpole in 1742, the Norse god Baldr or Robin Hood have no evidence behind them, and the rhyme is centuries older than Walpole.",
    modern: "Many hands are in one death: the maker, the checker, the council, the software, the drone. No one is charged.",
    trivia: [
      "Walter Potter's 1861 taxidermy tableau of the funeral used 98 species of British birds.",
      "In Disney's 1935 cartoon the judge sentences all three suspects to hang because he can't tell which one did it.",
    ],
    singers:
      "Everyone asks; Andy, Sarah, Abe, Webster, Desmond, Robert and Richard answer; Robert, Andy, Webster and Richard sing the funeral chorale; Sarah ends it.",
    duration: "2:13",
    megabytes: "2.1",
  },
];

export const cast: { singer: string; roles: string }[] = [
  { singer: "Robert", roles: "The lead and the narrator." },
  { singer: "Sarah", roles: "The mother, the lady and the driver." },
  { singer: "Webster", roles: "Harmony and baritone." },
  { singer: "Andy", roles: "The tenor, and the builder who calls each line." },
  { singer: "Abe", roles: "The master, the page, the tolling bell and the low drones." },
  { singer: "Desmond", roles: "The app and the software; knocks and drums." },
  { singer: "Richard", roles: "The bass, the bells and the oars." },
  { singer: "Tracy", roles: "The children, a bell and the high hums." },
];

export const sources: { label: string; href: string }[] = [
  { label: "Baa, Baa, Black Sheep (Wikipedia)", href: "https://en.wikipedia.org/wiki/Baa,_Baa,_Black_Sheep" },
  { label: "London Bridge (Wikipedia)", href: "https://en.wikipedia.org/wiki/London_Bridge" },
  { label: "Willie Winkie, William Miller's 1841 text (Representative Poetry Online)", href: "https://rpo.library.utoronto.ca/content/willie-winkie" },
  { label: "Sing a Song of Sixpence (Wikipedia)", href: "https://en.wikipedia.org/wiki/Sing_a_Song_of_Sixpence" },
  { label: "Gammer Gurton's Garland, 1810 edition (Project Gutenberg)", href: "https://www.gutenberg.org/ebooks/34601" },
  { label: "Ring a Ring o' Roses (Wikipedia)", href: "https://en.wikipedia.org/wiki/Ring_a_Ring_o%27_Roses" },
  { label: "Ladybird, Ladybird (Wikipedia)", href: "https://en.wikipedia.org/wiki/Ladybird,_Ladybird" },
  { label: "Malbrough s'en va-t-en guerre (Wikipedia)", href: "https://en.wikipedia.org/wiki/Malbrough_s%27en_va-t-en_guerre" },
  { label: "Wiegenlied, Brahms' Lullaby (Wikipedia)", href: "https://en.wikipedia.org/wiki/Wiegenlied_(Brahms)" },
  { label: "Row, Row, Row Your Boat (Wikipedia)", href: "https://en.wikipedia.org/wiki/Row,_Row,_Row_Your_Boat" },
  { label: "Oranges and Lemons (Wikipedia)", href: "https://en.wikipedia.org/wiki/Oranges_and_Lemons" },
  { label: "St Sepulchre's and the Newgate bell (British History Online)", href: "https://www.british-history.ac.uk/old-new-london/vol2/pp477-491" },
  { label: "Cock Robin (Wikipedia)", href: "https://en.wikipedia.org/wiki/Cock_Robin" },
];
