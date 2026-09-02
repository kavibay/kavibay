/** Bundled emoji catalog generated from gemoji (GitHub). */
export type EmojiCategoryId =
  | "smileys"
  | "people"
  | "animals"
  | "food"
  | "travel"
  | "activities"
  | "objects"
  | "symbols"
  | "flags";

export interface EmojiEntry {
  glyph: string;
  name: string;
  keywords: string[];
  category: EmojiCategoryId;
  /** When true, Fitzpatrick modifiers can be applied. */
  skinnable?: boolean;
}

export const EMOJI_CATEGORIES: { id: EmojiCategoryId; label: string }[] = [
  { id: "smileys", label: "Smileys" },
  { id: "people", label: "People" },
  { id: "animals", label: "Animals" },
  { id: "food", label: "Food" },
  { id: "travel", label: "Travel" },
  { id: "activities", label: "Activity" },
  { id: "objects", label: "Objects" },
  { id: "symbols", label: "Symbols" },
  { id: "flags", label: "Flags" },
];

export const EMOJI_DATA: EmojiEntry[] =
[
  {
    "glyph": "😀",
    "name": "grinning face",
    "keywords": [
      "grinning",
      "smile",
      "happy"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😃",
    "name": "grinning face with big eyes",
    "keywords": [
      "smiley",
      "happy",
      "joy",
      "haha"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😄",
    "name": "grinning face with smiling eyes",
    "keywords": [
      "smile",
      "happy",
      "joy",
      "laugh",
      "pleased"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😁",
    "name": "beaming face with smiling eyes",
    "keywords": [
      "grin"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😆",
    "name": "grinning squinting face",
    "keywords": [
      "laughing",
      "satisfied",
      "happy",
      "haha"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😅",
    "name": "grinning face with sweat",
    "keywords": [
      "sweat_smile",
      "hot"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤣",
    "name": "rolling on the floor laughing",
    "keywords": [
      "rofl",
      "lol",
      "laughing"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😂",
    "name": "face with tears of joy",
    "keywords": [
      "joy",
      "tears"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🙂",
    "name": "slightly smiling face",
    "keywords": [
      "slightly_smiling_face"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🙃",
    "name": "upside-down face",
    "keywords": [
      "upside_down_face"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🫠",
    "name": "melting face",
    "keywords": [
      "melting_face",
      "sarcasm",
      "dread"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😉",
    "name": "winking face",
    "keywords": [
      "wink",
      "flirt"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😊",
    "name": "smiling face with smiling eyes",
    "keywords": [
      "blush",
      "proud"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😇",
    "name": "smiling face with halo",
    "keywords": [
      "innocent",
      "angel"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🥰",
    "name": "smiling face with hearts",
    "keywords": [
      "smiling_face_with_three_hearts",
      "love"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😍",
    "name": "smiling face with heart-eyes",
    "keywords": [
      "heart_eyes",
      "love",
      "crush"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤩",
    "name": "star-struck",
    "keywords": [
      "star_struck",
      "eyes"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😘",
    "name": "face blowing a kiss",
    "keywords": [
      "kissing_heart",
      "flirt"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😗",
    "name": "kissing face",
    "keywords": [
      "kissing"
    ],
    "category": "smileys"
  },
  {
    "glyph": "☺️",
    "name": "smiling face",
    "keywords": [
      "relaxed",
      "blush",
      "pleased"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😚",
    "name": "kissing face with closed eyes",
    "keywords": [
      "kissing_closed_eyes"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😙",
    "name": "kissing face with smiling eyes",
    "keywords": [
      "kissing_smiling_eyes"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🥲",
    "name": "smiling face with tear",
    "keywords": [
      "smiling_face_with_tear"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😋",
    "name": "face savoring food",
    "keywords": [
      "yum",
      "tongue",
      "lick"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😛",
    "name": "face with tongue",
    "keywords": [
      "stuck_out_tongue"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😜",
    "name": "winking face with tongue",
    "keywords": [
      "stuck_out_tongue_winking_eye",
      "prank",
      "silly"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤪",
    "name": "zany face",
    "keywords": [
      "zany_face",
      "goofy",
      "wacky"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😝",
    "name": "squinting face with tongue",
    "keywords": [
      "stuck_out_tongue_closed_eyes",
      "prank"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤑",
    "name": "money-mouth face",
    "keywords": [
      "money_mouth_face",
      "rich"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤗",
    "name": "smiling face with open hands",
    "keywords": [
      "hugs"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤭",
    "name": "face with hand over mouth",
    "keywords": [
      "hand_over_mouth",
      "quiet",
      "whoops"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🫢",
    "name": "face with open eyes and hand over mouth",
    "keywords": [
      "face_with_open_eyes_and_hand_over_mouth",
      "gasp",
      "shock"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🫣",
    "name": "face with peeking eye",
    "keywords": [
      "face_with_peeking_eye"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤫",
    "name": "shushing face",
    "keywords": [
      "shushing_face",
      "silence",
      "quiet"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤔",
    "name": "thinking face",
    "keywords": [
      "thinking"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🫡",
    "name": "saluting face",
    "keywords": [
      "saluting_face",
      "respect"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤐",
    "name": "zipper-mouth face",
    "keywords": [
      "zipper_mouth_face",
      "silence",
      "hush"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤨",
    "name": "face with raised eyebrow",
    "keywords": [
      "raised_eyebrow",
      "suspicious"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😐",
    "name": "neutral face",
    "keywords": [
      "neutral_face",
      "meh"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😑",
    "name": "expressionless face",
    "keywords": [
      "expressionless"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😶",
    "name": "face without mouth",
    "keywords": [
      "no_mouth",
      "mute",
      "silence"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🫥",
    "name": "dotted line face",
    "keywords": [
      "dotted_line_face",
      "invisible"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😶‍🌫️",
    "name": "face in clouds",
    "keywords": [
      "face_in_clouds"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😏",
    "name": "smirking face",
    "keywords": [
      "smirk",
      "smug"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😒",
    "name": "unamused face",
    "keywords": [
      "unamused",
      "meh"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🙄",
    "name": "face with rolling eyes",
    "keywords": [
      "roll_eyes"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😬",
    "name": "grimacing face",
    "keywords": [
      "grimacing"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😮‍💨",
    "name": "face exhaling",
    "keywords": [
      "face_exhaling"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤥",
    "name": "lying face",
    "keywords": [
      "lying_face",
      "liar"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🫨",
    "name": "shaking face",
    "keywords": [
      "shaking_face",
      "shock"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😌",
    "name": "relieved face",
    "keywords": [
      "relieved",
      "whew"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😔",
    "name": "pensive face",
    "keywords": [
      "pensive"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😪",
    "name": "sleepy face",
    "keywords": [
      "sleepy",
      "tired"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤤",
    "name": "drooling face",
    "keywords": [
      "drooling_face"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😴",
    "name": "sleeping face",
    "keywords": [
      "sleeping",
      "zzz"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😷",
    "name": "face with medical mask",
    "keywords": [
      "mask",
      "sick",
      "ill"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤒",
    "name": "face with thermometer",
    "keywords": [
      "face_with_thermometer",
      "sick"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤕",
    "name": "face with head-bandage",
    "keywords": [
      "face_with_head_bandage",
      "hurt"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤢",
    "name": "nauseated face",
    "keywords": [
      "nauseated_face",
      "sick",
      "barf",
      "disgusted"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤮",
    "name": "face vomiting",
    "keywords": [
      "vomiting_face",
      "barf",
      "sick"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤧",
    "name": "sneezing face",
    "keywords": [
      "sneezing_face",
      "achoo",
      "sick"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🥵",
    "name": "hot face",
    "keywords": [
      "hot_face",
      "heat",
      "sweating"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🥶",
    "name": "cold face",
    "keywords": [
      "cold_face",
      "freezing",
      "ice"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🥴",
    "name": "woozy face",
    "keywords": [
      "woozy_face",
      "groggy"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😵",
    "name": "face with crossed-out eyes",
    "keywords": [
      "dizzy_face"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😵‍💫",
    "name": "face with spiral eyes",
    "keywords": [
      "face_with_spiral_eyes"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤯",
    "name": "exploding head",
    "keywords": [
      "exploding_head",
      "mind",
      "blown"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤠",
    "name": "cowboy hat face",
    "keywords": [
      "cowboy_hat_face"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🥳",
    "name": "partying face",
    "keywords": [
      "partying_face",
      "celebration",
      "birthday"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🥸",
    "name": "disguised face",
    "keywords": [
      "disguised_face"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😎",
    "name": "smiling face with sunglasses",
    "keywords": [
      "sunglasses",
      "cool"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤓",
    "name": "nerd face",
    "keywords": [
      "nerd_face",
      "geek",
      "glasses"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🧐",
    "name": "face with monocle",
    "keywords": [
      "monocle_face"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😕",
    "name": "confused face",
    "keywords": [
      "confused"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🫤",
    "name": "face with diagonal mouth",
    "keywords": [
      "face_with_diagonal_mouth",
      "confused"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😟",
    "name": "worried face",
    "keywords": [
      "worried",
      "nervous"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🙁",
    "name": "slightly frowning face",
    "keywords": [
      "slightly_frowning_face"
    ],
    "category": "smileys"
  },
  {
    "glyph": "☹️",
    "name": "frowning face",
    "keywords": [
      "frowning_face"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😮",
    "name": "face with open mouth",
    "keywords": [
      "open_mouth",
      "surprise",
      "impressed",
      "wow"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😯",
    "name": "hushed face",
    "keywords": [
      "hushed",
      "silence",
      "speechless"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😲",
    "name": "astonished face",
    "keywords": [
      "astonished",
      "amazed",
      "gasp"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😳",
    "name": "flushed face",
    "keywords": [
      "flushed"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🥺",
    "name": "pleading face",
    "keywords": [
      "pleading_face",
      "puppy",
      "eyes"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🥹",
    "name": "face holding back tears",
    "keywords": [
      "face_holding_back_tears",
      "tears",
      "gratitude"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😦",
    "name": "frowning face with open mouth",
    "keywords": [
      "frowning"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😧",
    "name": "anguished face",
    "keywords": [
      "anguished",
      "stunned"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😨",
    "name": "fearful face",
    "keywords": [
      "fearful",
      "scared",
      "shocked",
      "oops"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😰",
    "name": "anxious face with sweat",
    "keywords": [
      "cold_sweat",
      "nervous"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😥",
    "name": "sad but relieved face",
    "keywords": [
      "disappointed_relieved",
      "phew",
      "sweat",
      "nervous"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😢",
    "name": "crying face",
    "keywords": [
      "cry",
      "sad",
      "tear"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😭",
    "name": "loudly crying face",
    "keywords": [
      "sob",
      "sad",
      "cry",
      "bawling"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😱",
    "name": "face screaming in fear",
    "keywords": [
      "scream",
      "horror",
      "shocked"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😖",
    "name": "confounded face",
    "keywords": [
      "confounded"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😣",
    "name": "persevering face",
    "keywords": [
      "persevere",
      "struggling"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😞",
    "name": "disappointed face",
    "keywords": [
      "disappointed",
      "sad"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😓",
    "name": "downcast face with sweat",
    "keywords": [
      "sweat"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😩",
    "name": "weary face",
    "keywords": [
      "weary",
      "tired"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😫",
    "name": "tired face",
    "keywords": [
      "tired_face",
      "upset",
      "whine"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🥱",
    "name": "yawning face",
    "keywords": [
      "yawning_face"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😤",
    "name": "face with steam from nose",
    "keywords": [
      "triumph",
      "smug"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😡",
    "name": "enraged face",
    "keywords": [
      "rage",
      "pout",
      "angry"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😠",
    "name": "angry face",
    "keywords": [
      "angry",
      "mad",
      "annoyed"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤬",
    "name": "face with symbols on mouth",
    "keywords": [
      "cursing_face",
      "foul"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😈",
    "name": "smiling face with horns",
    "keywords": [
      "smiling_imp",
      "devil",
      "evil",
      "horns"
    ],
    "category": "smileys"
  },
  {
    "glyph": "👿",
    "name": "angry face with horns",
    "keywords": [
      "imp",
      "angry",
      "devil",
      "evil",
      "horns"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💀",
    "name": "skull",
    "keywords": [
      "skull",
      "dead",
      "danger",
      "poison"
    ],
    "category": "smileys"
  },
  {
    "glyph": "☠️",
    "name": "skull and crossbones",
    "keywords": [
      "skull_and_crossbones",
      "danger",
      "pirate"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💩",
    "name": "pile of poo",
    "keywords": [
      "hankey",
      "poop",
      "shit",
      "crap"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤡",
    "name": "clown face",
    "keywords": [
      "clown_face"
    ],
    "category": "smileys"
  },
  {
    "glyph": "👹",
    "name": "ogre",
    "keywords": [
      "japanese_ogre",
      "monster"
    ],
    "category": "smileys"
  },
  {
    "glyph": "👺",
    "name": "goblin",
    "keywords": [
      "japanese_goblin"
    ],
    "category": "smileys"
  },
  {
    "glyph": "👻",
    "name": "ghost",
    "keywords": [
      "ghost",
      "halloween"
    ],
    "category": "smileys"
  },
  {
    "glyph": "👽",
    "name": "alien",
    "keywords": [
      "alien",
      "ufo"
    ],
    "category": "smileys"
  },
  {
    "glyph": "👾",
    "name": "alien monster",
    "keywords": [
      "space_invader",
      "game",
      "retro"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤖",
    "name": "robot",
    "keywords": [
      "robot"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😺",
    "name": "grinning cat",
    "keywords": [
      "smiley_cat"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😸",
    "name": "grinning cat with smiling eyes",
    "keywords": [
      "smile_cat"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😹",
    "name": "cat with tears of joy",
    "keywords": [
      "joy_cat"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😻",
    "name": "smiling cat with heart-eyes",
    "keywords": [
      "heart_eyes_cat"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😼",
    "name": "cat with wry smile",
    "keywords": [
      "smirk_cat"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😽",
    "name": "kissing cat",
    "keywords": [
      "kissing_cat"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🙀",
    "name": "weary cat",
    "keywords": [
      "scream_cat",
      "horror"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😿",
    "name": "crying cat",
    "keywords": [
      "crying_cat_face",
      "sad",
      "tear"
    ],
    "category": "smileys"
  },
  {
    "glyph": "😾",
    "name": "pouting cat",
    "keywords": [
      "pouting_cat"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🙈",
    "name": "see-no-evil monkey",
    "keywords": [
      "see_no_evil",
      "monkey",
      "blind",
      "ignore"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🙉",
    "name": "hear-no-evil monkey",
    "keywords": [
      "hear_no_evil",
      "monkey",
      "deaf"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🙊",
    "name": "speak-no-evil monkey",
    "keywords": [
      "speak_no_evil",
      "monkey",
      "mute",
      "hush"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💌",
    "name": "love letter",
    "keywords": [
      "love_letter",
      "email",
      "envelope"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💘",
    "name": "heart with arrow",
    "keywords": [
      "cupid",
      "love",
      "heart"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💝",
    "name": "heart with ribbon",
    "keywords": [
      "gift_heart",
      "chocolates"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💖",
    "name": "sparkling heart",
    "keywords": [
      "sparkling_heart"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💗",
    "name": "growing heart",
    "keywords": [
      "heartpulse"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💓",
    "name": "beating heart",
    "keywords": [
      "heartbeat"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💞",
    "name": "revolving hearts",
    "keywords": [
      "revolving_hearts"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💕",
    "name": "two hearts",
    "keywords": [
      "two_hearts"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💟",
    "name": "heart decoration",
    "keywords": [
      "heart_decoration"
    ],
    "category": "smileys"
  },
  {
    "glyph": "❣️",
    "name": "heart exclamation",
    "keywords": [
      "heavy_heart_exclamation"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💔",
    "name": "broken heart",
    "keywords": [
      "broken_heart"
    ],
    "category": "smileys"
  },
  {
    "glyph": "❤️‍🔥",
    "name": "heart on fire",
    "keywords": [
      "heart_on_fire"
    ],
    "category": "smileys"
  },
  {
    "glyph": "❤️‍🩹",
    "name": "mending heart",
    "keywords": [
      "mending_heart"
    ],
    "category": "smileys"
  },
  {
    "glyph": "❤️",
    "name": "red heart",
    "keywords": [
      "heart",
      "love"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🩷",
    "name": "pink heart",
    "keywords": [
      "pink_heart"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🧡",
    "name": "orange heart",
    "keywords": [
      "orange_heart"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💛",
    "name": "yellow heart",
    "keywords": [
      "yellow_heart"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💚",
    "name": "green heart",
    "keywords": [
      "green_heart"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💙",
    "name": "blue heart",
    "keywords": [
      "blue_heart"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🩵",
    "name": "light blue heart",
    "keywords": [
      "light_blue_heart"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💜",
    "name": "purple heart",
    "keywords": [
      "purple_heart"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤎",
    "name": "brown heart",
    "keywords": [
      "brown_heart"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🖤",
    "name": "black heart",
    "keywords": [
      "black_heart"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🩶",
    "name": "grey heart",
    "keywords": [
      "grey_heart"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🤍",
    "name": "white heart",
    "keywords": [
      "white_heart"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💋",
    "name": "kiss mark",
    "keywords": [
      "kiss",
      "lipstick"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💯",
    "name": "hundred points",
    "keywords": [
      "100",
      "score",
      "perfect"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💢",
    "name": "anger symbol",
    "keywords": [
      "anger",
      "angry"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💥",
    "name": "collision",
    "keywords": [
      "boom",
      "collision",
      "explode"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💫",
    "name": "dizzy",
    "keywords": [
      "dizzy",
      "star"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💦",
    "name": "sweat droplets",
    "keywords": [
      "sweat_drops",
      "water",
      "workout"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💨",
    "name": "dashing away",
    "keywords": [
      "dash",
      "wind",
      "blow",
      "fast"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🕳️",
    "name": "hole",
    "keywords": [
      "hole"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💬",
    "name": "speech balloon",
    "keywords": [
      "speech_balloon",
      "comment"
    ],
    "category": "smileys"
  },
  {
    "glyph": "👁️‍🗨️",
    "name": "eye in speech bubble",
    "keywords": [
      "eye_speech_bubble"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🗨️",
    "name": "left speech bubble",
    "keywords": [
      "left_speech_bubble"
    ],
    "category": "smileys"
  },
  {
    "glyph": "🗯️",
    "name": "right anger bubble",
    "keywords": [
      "right_anger_bubble"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💭",
    "name": "thought balloon",
    "keywords": [
      "thought_balloon",
      "thinking"
    ],
    "category": "smileys"
  },
  {
    "glyph": "💤",
    "name": "ZZZ",
    "keywords": [
      "zzz",
      "sleeping"
    ],
    "category": "smileys"
  },
  {
    "glyph": "👋",
    "name": "waving hand",
    "keywords": [
      "wave",
      "goodbye"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤚",
    "name": "raised back of hand",
    "keywords": [
      "raised_back_of_hand"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🖐️",
    "name": "hand with fingers splayed",
    "keywords": [
      "raised_hand_with_fingers_splayed"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "✋",
    "name": "raised hand",
    "keywords": [
      "hand",
      "raised_hand",
      "highfive",
      "stop"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🖖",
    "name": "vulcan salute",
    "keywords": [
      "vulcan_salute",
      "prosper",
      "spock"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🫱",
    "name": "rightwards hand",
    "keywords": [
      "rightwards_hand"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🫲",
    "name": "leftwards hand",
    "keywords": [
      "leftwards_hand"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🫳",
    "name": "palm down hand",
    "keywords": [
      "palm_down_hand"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🫴",
    "name": "palm up hand",
    "keywords": [
      "palm_up_hand"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🫷",
    "name": "leftwards pushing hand",
    "keywords": [
      "leftwards_pushing_hand"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🫸",
    "name": "rightwards pushing hand",
    "keywords": [
      "rightwards_pushing_hand"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👌",
    "name": "OK hand",
    "keywords": [
      "ok_hand"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤌",
    "name": "pinched fingers",
    "keywords": [
      "pinched_fingers"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤏",
    "name": "pinching hand",
    "keywords": [
      "pinching_hand"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "✌️",
    "name": "victory hand",
    "keywords": [
      "v",
      "victory",
      "peace"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤞",
    "name": "crossed fingers",
    "keywords": [
      "crossed_fingers",
      "luck",
      "hopeful"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🫰",
    "name": "hand with index finger and thumb crossed",
    "keywords": [
      "hand_with_index_finger_and_thumb_crossed"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤟",
    "name": "love-you gesture",
    "keywords": [
      "love_you_gesture"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤘",
    "name": "sign of the horns",
    "keywords": [
      "metal"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤙",
    "name": "call me hand",
    "keywords": [
      "call_me_hand"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👈",
    "name": "backhand index pointing left",
    "keywords": [
      "point_left"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👉",
    "name": "backhand index pointing right",
    "keywords": [
      "point_right"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👆",
    "name": "backhand index pointing up",
    "keywords": [
      "point_up_2"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🖕",
    "name": "middle finger",
    "keywords": [
      "middle_finger",
      "fu"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👇",
    "name": "backhand index pointing down",
    "keywords": [
      "point_down"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "☝️",
    "name": "index pointing up",
    "keywords": [
      "point_up"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🫵",
    "name": "index pointing at the viewer",
    "keywords": [
      "index_pointing_at_the_viewer"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👍",
    "name": "thumbs up",
    "keywords": [
      "+1",
      "thumbsup",
      "approve",
      "ok"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👎",
    "name": "thumbs down",
    "keywords": [
      "-1",
      "thumbsdown",
      "disapprove",
      "bury"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "✊",
    "name": "raised fist",
    "keywords": [
      "fist_raised",
      "fist",
      "power"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👊",
    "name": "oncoming fist",
    "keywords": [
      "fist_oncoming",
      "facepunch",
      "punch",
      "attack"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤛",
    "name": "left-facing fist",
    "keywords": [
      "fist_left"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤜",
    "name": "right-facing fist",
    "keywords": [
      "fist_right"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👏",
    "name": "clapping hands",
    "keywords": [
      "clap",
      "praise",
      "applause"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙌",
    "name": "raising hands",
    "keywords": [
      "raised_hands",
      "hooray"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🫶",
    "name": "heart hands",
    "keywords": [
      "heart_hands",
      "love"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👐",
    "name": "open hands",
    "keywords": [
      "open_hands"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤲",
    "name": "palms up together",
    "keywords": [
      "palms_up_together"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤝",
    "name": "handshake",
    "keywords": [
      "handshake",
      "deal"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙏",
    "name": "folded hands",
    "keywords": [
      "pray",
      "please",
      "hope",
      "wish"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "✍️",
    "name": "writing hand",
    "keywords": [
      "writing_hand"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "💅",
    "name": "nail polish",
    "keywords": [
      "nail_care",
      "beauty",
      "manicure"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤳",
    "name": "selfie",
    "keywords": [
      "selfie"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "💪",
    "name": "flexed biceps",
    "keywords": [
      "muscle",
      "flex",
      "bicep",
      "strong",
      "workout"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🦾",
    "name": "mechanical arm",
    "keywords": [
      "mechanical_arm"
    ],
    "category": "people"
  },
  {
    "glyph": "🦿",
    "name": "mechanical leg",
    "keywords": [
      "mechanical_leg"
    ],
    "category": "people"
  },
  {
    "glyph": "🦵",
    "name": "leg",
    "keywords": [
      "leg"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🦶",
    "name": "foot",
    "keywords": [
      "foot"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👂",
    "name": "ear",
    "keywords": [
      "ear",
      "hear",
      "sound",
      "listen"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🦻",
    "name": "ear with hearing aid",
    "keywords": [
      "ear_with_hearing_aid"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👃",
    "name": "nose",
    "keywords": [
      "nose",
      "smell"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧠",
    "name": "brain",
    "keywords": [
      "brain"
    ],
    "category": "people"
  },
  {
    "glyph": "🫀",
    "name": "anatomical heart",
    "keywords": [
      "anatomical_heart"
    ],
    "category": "people"
  },
  {
    "glyph": "🫁",
    "name": "lungs",
    "keywords": [
      "lungs"
    ],
    "category": "people"
  },
  {
    "glyph": "🦷",
    "name": "tooth",
    "keywords": [
      "tooth"
    ],
    "category": "people"
  },
  {
    "glyph": "🦴",
    "name": "bone",
    "keywords": [
      "bone"
    ],
    "category": "people"
  },
  {
    "glyph": "👀",
    "name": "eyes",
    "keywords": [
      "eyes",
      "look",
      "see",
      "watch"
    ],
    "category": "people"
  },
  {
    "glyph": "👁️",
    "name": "eye",
    "keywords": [
      "eye"
    ],
    "category": "people"
  },
  {
    "glyph": "👅",
    "name": "tongue",
    "keywords": [
      "tongue",
      "taste"
    ],
    "category": "people"
  },
  {
    "glyph": "👄",
    "name": "mouth",
    "keywords": [
      "lips",
      "kiss"
    ],
    "category": "people"
  },
  {
    "glyph": "🫦",
    "name": "biting lip",
    "keywords": [
      "biting_lip"
    ],
    "category": "people"
  },
  {
    "glyph": "👶",
    "name": "baby",
    "keywords": [
      "baby",
      "child",
      "newborn"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧒",
    "name": "child",
    "keywords": [
      "child"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👦",
    "name": "boy",
    "keywords": [
      "boy",
      "child"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👧",
    "name": "girl",
    "keywords": [
      "girl",
      "child"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑",
    "name": "person",
    "keywords": [
      "adult"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👱",
    "name": "person: blond hair",
    "keywords": [
      "blond_haired_person"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨",
    "name": "man",
    "keywords": [
      "man",
      "mustache",
      "father",
      "dad"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧔",
    "name": "person: beard",
    "keywords": [
      "bearded_person"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧔‍♂️",
    "name": "man: beard",
    "keywords": [
      "man_beard"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧔‍♀️",
    "name": "woman: beard",
    "keywords": [
      "woman_beard"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🦰",
    "name": "man: red hair",
    "keywords": [
      "red_haired_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🦱",
    "name": "man: curly hair",
    "keywords": [
      "curly_haired_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🦳",
    "name": "man: white hair",
    "keywords": [
      "white_haired_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🦲",
    "name": "man: bald",
    "keywords": [
      "bald_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩",
    "name": "woman",
    "keywords": [
      "woman",
      "girls"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🦰",
    "name": "woman: red hair",
    "keywords": [
      "red_haired_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🦰",
    "name": "person: red hair",
    "keywords": [
      "person_red_hair"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🦱",
    "name": "woman: curly hair",
    "keywords": [
      "curly_haired_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🦱",
    "name": "person: curly hair",
    "keywords": [
      "person_curly_hair"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🦳",
    "name": "woman: white hair",
    "keywords": [
      "white_haired_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🦳",
    "name": "person: white hair",
    "keywords": [
      "person_white_hair"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🦲",
    "name": "woman: bald",
    "keywords": [
      "bald_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🦲",
    "name": "person: bald",
    "keywords": [
      "person_bald"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👱‍♀️",
    "name": "woman: blond hair",
    "keywords": [
      "blond_haired_woman",
      "blonde_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👱‍♂️",
    "name": "man: blond hair",
    "keywords": [
      "blond_haired_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧓",
    "name": "older person",
    "keywords": [
      "older_adult"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👴",
    "name": "old man",
    "keywords": [
      "older_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👵",
    "name": "old woman",
    "keywords": [
      "older_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙍",
    "name": "person frowning",
    "keywords": [
      "frowning_person"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙍‍♂️",
    "name": "man frowning",
    "keywords": [
      "frowning_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙍‍♀️",
    "name": "woman frowning",
    "keywords": [
      "frowning_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙎",
    "name": "person pouting",
    "keywords": [
      "pouting_face"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙎‍♂️",
    "name": "man pouting",
    "keywords": [
      "pouting_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙎‍♀️",
    "name": "woman pouting",
    "keywords": [
      "pouting_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙅",
    "name": "person gesturing NO",
    "keywords": [
      "no_good",
      "stop",
      "halt",
      "denied"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙅‍♂️",
    "name": "man gesturing NO",
    "keywords": [
      "no_good_man",
      "ng_man",
      "stop",
      "halt",
      "denied"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙅‍♀️",
    "name": "woman gesturing NO",
    "keywords": [
      "no_good_woman",
      "ng_woman",
      "stop",
      "halt",
      "denied"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙆",
    "name": "person gesturing OK",
    "keywords": [
      "ok_person"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙆‍♂️",
    "name": "man gesturing OK",
    "keywords": [
      "ok_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙆‍♀️",
    "name": "woman gesturing OK",
    "keywords": [
      "ok_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "💁",
    "name": "person tipping hand",
    "keywords": [
      "tipping_hand_person",
      "information_desk_person"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "💁‍♂️",
    "name": "man tipping hand",
    "keywords": [
      "tipping_hand_man",
      "sassy_man",
      "information"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "💁‍♀️",
    "name": "woman tipping hand",
    "keywords": [
      "tipping_hand_woman",
      "sassy_woman",
      "information"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙋",
    "name": "person raising hand",
    "keywords": [
      "raising_hand"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙋‍♂️",
    "name": "man raising hand",
    "keywords": [
      "raising_hand_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙋‍♀️",
    "name": "woman raising hand",
    "keywords": [
      "raising_hand_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧏",
    "name": "deaf person",
    "keywords": [
      "deaf_person"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧏‍♂️",
    "name": "deaf man",
    "keywords": [
      "deaf_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧏‍♀️",
    "name": "deaf woman",
    "keywords": [
      "deaf_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙇",
    "name": "person bowing",
    "keywords": [
      "bow",
      "respect",
      "thanks"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙇‍♂️",
    "name": "man bowing",
    "keywords": [
      "bowing_man",
      "respect",
      "thanks"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🙇‍♀️",
    "name": "woman bowing",
    "keywords": [
      "bowing_woman",
      "respect",
      "thanks"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤦",
    "name": "person facepalming",
    "keywords": [
      "facepalm"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤦‍♂️",
    "name": "man facepalming",
    "keywords": [
      "man_facepalming"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤦‍♀️",
    "name": "woman facepalming",
    "keywords": [
      "woman_facepalming"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤷",
    "name": "person shrugging",
    "keywords": [
      "shrug"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤷‍♂️",
    "name": "man shrugging",
    "keywords": [
      "man_shrugging"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤷‍♀️",
    "name": "woman shrugging",
    "keywords": [
      "woman_shrugging"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍⚕️",
    "name": "health worker",
    "keywords": [
      "health_worker"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍⚕️",
    "name": "man health worker",
    "keywords": [
      "man_health_worker",
      "doctor",
      "nurse"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍⚕️",
    "name": "woman health worker",
    "keywords": [
      "woman_health_worker",
      "doctor",
      "nurse"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🎓",
    "name": "student",
    "keywords": [
      "student"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🎓",
    "name": "man student",
    "keywords": [
      "man_student",
      "graduation"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🎓",
    "name": "woman student",
    "keywords": [
      "woman_student",
      "graduation"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🏫",
    "name": "teacher",
    "keywords": [
      "teacher"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🏫",
    "name": "man teacher",
    "keywords": [
      "man_teacher",
      "school",
      "professor"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🏫",
    "name": "woman teacher",
    "keywords": [
      "woman_teacher",
      "school",
      "professor"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍⚖️",
    "name": "judge",
    "keywords": [
      "judge"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍⚖️",
    "name": "man judge",
    "keywords": [
      "man_judge",
      "justice"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍⚖️",
    "name": "woman judge",
    "keywords": [
      "woman_judge",
      "justice"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🌾",
    "name": "farmer",
    "keywords": [
      "farmer"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🌾",
    "name": "man farmer",
    "keywords": [
      "man_farmer"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🌾",
    "name": "woman farmer",
    "keywords": [
      "woman_farmer"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🍳",
    "name": "cook",
    "keywords": [
      "cook"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🍳",
    "name": "man cook",
    "keywords": [
      "man_cook",
      "chef"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🍳",
    "name": "woman cook",
    "keywords": [
      "woman_cook",
      "chef"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🔧",
    "name": "mechanic",
    "keywords": [
      "mechanic"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🔧",
    "name": "man mechanic",
    "keywords": [
      "man_mechanic"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🔧",
    "name": "woman mechanic",
    "keywords": [
      "woman_mechanic"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🏭",
    "name": "factory worker",
    "keywords": [
      "factory_worker"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🏭",
    "name": "man factory worker",
    "keywords": [
      "man_factory_worker"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🏭",
    "name": "woman factory worker",
    "keywords": [
      "woman_factory_worker"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍💼",
    "name": "office worker",
    "keywords": [
      "office_worker"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍💼",
    "name": "man office worker",
    "keywords": [
      "man_office_worker",
      "business"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍💼",
    "name": "woman office worker",
    "keywords": [
      "woman_office_worker",
      "business"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🔬",
    "name": "scientist",
    "keywords": [
      "scientist"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🔬",
    "name": "man scientist",
    "keywords": [
      "man_scientist",
      "research"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🔬",
    "name": "woman scientist",
    "keywords": [
      "woman_scientist",
      "research"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍💻",
    "name": "technologist",
    "keywords": [
      "technologist"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍💻",
    "name": "man technologist",
    "keywords": [
      "man_technologist",
      "coder"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍💻",
    "name": "woman technologist",
    "keywords": [
      "woman_technologist",
      "coder"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🎤",
    "name": "singer",
    "keywords": [
      "singer"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🎤",
    "name": "man singer",
    "keywords": [
      "man_singer",
      "rockstar"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🎤",
    "name": "woman singer",
    "keywords": [
      "woman_singer",
      "rockstar"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🎨",
    "name": "artist",
    "keywords": [
      "artist"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🎨",
    "name": "man artist",
    "keywords": [
      "man_artist",
      "painter"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🎨",
    "name": "woman artist",
    "keywords": [
      "woman_artist",
      "painter"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍✈️",
    "name": "pilot",
    "keywords": [
      "pilot"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍✈️",
    "name": "man pilot",
    "keywords": [
      "man_pilot"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍✈️",
    "name": "woman pilot",
    "keywords": [
      "woman_pilot"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🚀",
    "name": "astronaut",
    "keywords": [
      "astronaut"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🚀",
    "name": "man astronaut",
    "keywords": [
      "man_astronaut",
      "space"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🚀",
    "name": "woman astronaut",
    "keywords": [
      "woman_astronaut",
      "space"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🚒",
    "name": "firefighter",
    "keywords": [
      "firefighter"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🚒",
    "name": "man firefighter",
    "keywords": [
      "man_firefighter"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🚒",
    "name": "woman firefighter",
    "keywords": [
      "woman_firefighter"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👮",
    "name": "police officer",
    "keywords": [
      "police_officer",
      "cop",
      "law"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👮‍♂️",
    "name": "man police officer",
    "keywords": [
      "policeman",
      "law",
      "cop"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👮‍♀️",
    "name": "woman police officer",
    "keywords": [
      "policewoman",
      "law",
      "cop"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🕵️",
    "name": "detective",
    "keywords": [
      "detective",
      "sleuth"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🕵️‍♂️",
    "name": "man detective",
    "keywords": [
      "male_detective",
      "sleuth"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🕵️‍♀️",
    "name": "woman detective",
    "keywords": [
      "female_detective",
      "sleuth"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "💂",
    "name": "guard",
    "keywords": [
      "guard"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "💂‍♂️",
    "name": "man guard",
    "keywords": [
      "guardsman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "💂‍♀️",
    "name": "woman guard",
    "keywords": [
      "guardswoman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🥷",
    "name": "ninja",
    "keywords": [
      "ninja"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👷",
    "name": "construction worker",
    "keywords": [
      "construction_worker",
      "helmet"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👷‍♂️",
    "name": "man construction worker",
    "keywords": [
      "construction_worker_man",
      "helmet"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👷‍♀️",
    "name": "woman construction worker",
    "keywords": [
      "construction_worker_woman",
      "helmet"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🫅",
    "name": "person with crown",
    "keywords": [
      "person_with_crown"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤴",
    "name": "prince",
    "keywords": [
      "prince",
      "crown",
      "royal"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👸",
    "name": "princess",
    "keywords": [
      "princess",
      "crown",
      "royal"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👳",
    "name": "person wearing turban",
    "keywords": [
      "person_with_turban"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👳‍♂️",
    "name": "man wearing turban",
    "keywords": [
      "man_with_turban"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👳‍♀️",
    "name": "woman wearing turban",
    "keywords": [
      "woman_with_turban"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👲",
    "name": "person with skullcap",
    "keywords": [
      "man_with_gua_pi_mao"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧕",
    "name": "woman with headscarf",
    "keywords": [
      "woman_with_headscarf",
      "hijab"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤵",
    "name": "person in tuxedo",
    "keywords": [
      "person_in_tuxedo",
      "groom",
      "marriage",
      "wedding"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤵‍♂️",
    "name": "man in tuxedo",
    "keywords": [
      "man_in_tuxedo"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤵‍♀️",
    "name": "woman in tuxedo",
    "keywords": [
      "woman_in_tuxedo"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👰",
    "name": "person with veil",
    "keywords": [
      "person_with_veil",
      "marriage",
      "wedding"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👰‍♂️",
    "name": "man with veil",
    "keywords": [
      "man_with_veil"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👰‍♀️",
    "name": "woman with veil",
    "keywords": [
      "woman_with_veil",
      "bride_with_veil"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤰",
    "name": "pregnant woman",
    "keywords": [
      "pregnant_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🫃",
    "name": "pregnant man",
    "keywords": [
      "pregnant_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🫄",
    "name": "pregnant person",
    "keywords": [
      "pregnant_person"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤱",
    "name": "breast-feeding",
    "keywords": [
      "breast_feeding",
      "nursing"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🍼",
    "name": "woman feeding baby",
    "keywords": [
      "woman_feeding_baby"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🍼",
    "name": "man feeding baby",
    "keywords": [
      "man_feeding_baby"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🍼",
    "name": "person feeding baby",
    "keywords": [
      "person_feeding_baby"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👼",
    "name": "baby angel",
    "keywords": [
      "angel"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🎅",
    "name": "Santa Claus",
    "keywords": [
      "santa",
      "christmas"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤶",
    "name": "Mrs. Claus",
    "keywords": [
      "mrs_claus",
      "santa"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🎄",
    "name": "mx claus",
    "keywords": [
      "mx_claus"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🦸",
    "name": "superhero",
    "keywords": [
      "superhero"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🦸‍♂️",
    "name": "man superhero",
    "keywords": [
      "superhero_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🦸‍♀️",
    "name": "woman superhero",
    "keywords": [
      "superhero_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🦹",
    "name": "supervillain",
    "keywords": [
      "supervillain"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🦹‍♂️",
    "name": "man supervillain",
    "keywords": [
      "supervillain_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🦹‍♀️",
    "name": "woman supervillain",
    "keywords": [
      "supervillain_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧙",
    "name": "mage",
    "keywords": [
      "mage",
      "wizard"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧙‍♂️",
    "name": "man mage",
    "keywords": [
      "mage_man",
      "wizard"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧙‍♀️",
    "name": "woman mage",
    "keywords": [
      "mage_woman",
      "wizard"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧚",
    "name": "fairy",
    "keywords": [
      "fairy"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧚‍♂️",
    "name": "man fairy",
    "keywords": [
      "fairy_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧚‍♀️",
    "name": "woman fairy",
    "keywords": [
      "fairy_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧛",
    "name": "vampire",
    "keywords": [
      "vampire"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧛‍♂️",
    "name": "man vampire",
    "keywords": [
      "vampire_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧛‍♀️",
    "name": "woman vampire",
    "keywords": [
      "vampire_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧜",
    "name": "merperson",
    "keywords": [
      "merperson"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧜‍♂️",
    "name": "merman",
    "keywords": [
      "merman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧜‍♀️",
    "name": "mermaid",
    "keywords": [
      "mermaid"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧝",
    "name": "elf",
    "keywords": [
      "elf"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧝‍♂️",
    "name": "man elf",
    "keywords": [
      "elf_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧝‍♀️",
    "name": "woman elf",
    "keywords": [
      "elf_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧞",
    "name": "genie",
    "keywords": [
      "genie"
    ],
    "category": "people"
  },
  {
    "glyph": "🧞‍♂️",
    "name": "man genie",
    "keywords": [
      "genie_man"
    ],
    "category": "people"
  },
  {
    "glyph": "🧞‍♀️",
    "name": "woman genie",
    "keywords": [
      "genie_woman"
    ],
    "category": "people"
  },
  {
    "glyph": "🧟",
    "name": "zombie",
    "keywords": [
      "zombie"
    ],
    "category": "people"
  },
  {
    "glyph": "🧟‍♂️",
    "name": "man zombie",
    "keywords": [
      "zombie_man"
    ],
    "category": "people"
  },
  {
    "glyph": "🧟‍♀️",
    "name": "woman zombie",
    "keywords": [
      "zombie_woman"
    ],
    "category": "people"
  },
  {
    "glyph": "🧌",
    "name": "troll",
    "keywords": [
      "troll"
    ],
    "category": "people"
  },
  {
    "glyph": "💆",
    "name": "person getting massage",
    "keywords": [
      "massage",
      "spa"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "💆‍♂️",
    "name": "man getting massage",
    "keywords": [
      "massage_man",
      "spa"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "💆‍♀️",
    "name": "woman getting massage",
    "keywords": [
      "massage_woman",
      "spa"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "💇",
    "name": "person getting haircut",
    "keywords": [
      "haircut",
      "beauty"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "💇‍♂️",
    "name": "man getting haircut",
    "keywords": [
      "haircut_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "💇‍♀️",
    "name": "woman getting haircut",
    "keywords": [
      "haircut_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🚶",
    "name": "person walking",
    "keywords": [
      "walking"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🚶‍♂️",
    "name": "man walking",
    "keywords": [
      "walking_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🚶‍♀️",
    "name": "woman walking",
    "keywords": [
      "walking_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧍",
    "name": "person standing",
    "keywords": [
      "standing_person"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧍‍♂️",
    "name": "man standing",
    "keywords": [
      "standing_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧍‍♀️",
    "name": "woman standing",
    "keywords": [
      "standing_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧎",
    "name": "person kneeling",
    "keywords": [
      "kneeling_person"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧎‍♂️",
    "name": "man kneeling",
    "keywords": [
      "kneeling_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧎‍♀️",
    "name": "woman kneeling",
    "keywords": [
      "kneeling_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🦯",
    "name": "person with white cane",
    "keywords": [
      "person_with_probing_cane"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🦯",
    "name": "man with white cane",
    "keywords": [
      "man_with_probing_cane"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🦯",
    "name": "woman with white cane",
    "keywords": [
      "woman_with_probing_cane"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🦼",
    "name": "person in motorized wheelchair",
    "keywords": [
      "person_in_motorized_wheelchair"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🦼",
    "name": "man in motorized wheelchair",
    "keywords": [
      "man_in_motorized_wheelchair"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🦼",
    "name": "woman in motorized wheelchair",
    "keywords": [
      "woman_in_motorized_wheelchair"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🦽",
    "name": "person in manual wheelchair",
    "keywords": [
      "person_in_manual_wheelchair"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍🦽",
    "name": "man in manual wheelchair",
    "keywords": [
      "man_in_manual_wheelchair"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍🦽",
    "name": "woman in manual wheelchair",
    "keywords": [
      "woman_in_manual_wheelchair"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🏃",
    "name": "person running",
    "keywords": [
      "runner",
      "running",
      "exercise",
      "workout",
      "marathon"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🏃‍♂️",
    "name": "man running",
    "keywords": [
      "running_man",
      "exercise",
      "workout",
      "marathon"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🏃‍♀️",
    "name": "woman running",
    "keywords": [
      "running_woman",
      "exercise",
      "workout",
      "marathon"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "💃",
    "name": "woman dancing",
    "keywords": [
      "woman_dancing",
      "dancer",
      "dress"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🕺",
    "name": "man dancing",
    "keywords": [
      "man_dancing",
      "dancer"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🕴️",
    "name": "person in suit levitating",
    "keywords": [
      "business_suit_levitating"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👯",
    "name": "people with bunny ears",
    "keywords": [
      "dancers",
      "bunny"
    ],
    "category": "people"
  },
  {
    "glyph": "👯‍♂️",
    "name": "men with bunny ears",
    "keywords": [
      "dancing_men",
      "bunny"
    ],
    "category": "people"
  },
  {
    "glyph": "👯‍♀️",
    "name": "women with bunny ears",
    "keywords": [
      "dancing_women",
      "bunny"
    ],
    "category": "people"
  },
  {
    "glyph": "🧖",
    "name": "person in steamy room",
    "keywords": [
      "sauna_person",
      "steamy"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧖‍♂️",
    "name": "man in steamy room",
    "keywords": [
      "sauna_man",
      "steamy"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧖‍♀️",
    "name": "woman in steamy room",
    "keywords": [
      "sauna_woman",
      "steamy"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧗",
    "name": "person climbing",
    "keywords": [
      "climbing",
      "bouldering"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧗‍♂️",
    "name": "man climbing",
    "keywords": [
      "climbing_man",
      "bouldering"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧗‍♀️",
    "name": "woman climbing",
    "keywords": [
      "climbing_woman",
      "bouldering"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤺",
    "name": "person fencing",
    "keywords": [
      "person_fencing"
    ],
    "category": "people"
  },
  {
    "glyph": "🏇",
    "name": "horse racing",
    "keywords": [
      "horse_racing"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "⛷️",
    "name": "skier",
    "keywords": [
      "skier"
    ],
    "category": "people"
  },
  {
    "glyph": "🏂",
    "name": "snowboarder",
    "keywords": [
      "snowboarder"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🏌️",
    "name": "person golfing",
    "keywords": [
      "golfing"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🏌️‍♂️",
    "name": "man golfing",
    "keywords": [
      "golfing_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🏌️‍♀️",
    "name": "woman golfing",
    "keywords": [
      "golfing_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🏄",
    "name": "person surfing",
    "keywords": [
      "surfer"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🏄‍♂️",
    "name": "man surfing",
    "keywords": [
      "surfing_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🏄‍♀️",
    "name": "woman surfing",
    "keywords": [
      "surfing_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🚣",
    "name": "person rowing boat",
    "keywords": [
      "rowboat"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🚣‍♂️",
    "name": "man rowing boat",
    "keywords": [
      "rowing_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🚣‍♀️",
    "name": "woman rowing boat",
    "keywords": [
      "rowing_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🏊",
    "name": "person swimming",
    "keywords": [
      "swimmer"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🏊‍♂️",
    "name": "man swimming",
    "keywords": [
      "swimming_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🏊‍♀️",
    "name": "woman swimming",
    "keywords": [
      "swimming_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "⛹️",
    "name": "person bouncing ball",
    "keywords": [
      "bouncing_ball_person",
      "basketball"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "⛹️‍♂️",
    "name": "man bouncing ball",
    "keywords": [
      "bouncing_ball_man",
      "basketball_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "⛹️‍♀️",
    "name": "woman bouncing ball",
    "keywords": [
      "bouncing_ball_woman",
      "basketball_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🏋️",
    "name": "person lifting weights",
    "keywords": [
      "weight_lifting",
      "gym",
      "workout"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🏋️‍♂️",
    "name": "man lifting weights",
    "keywords": [
      "weight_lifting_man",
      "gym",
      "workout"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🏋️‍♀️",
    "name": "woman lifting weights",
    "keywords": [
      "weight_lifting_woman",
      "gym",
      "workout"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🚴",
    "name": "person biking",
    "keywords": [
      "bicyclist"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🚴‍♂️",
    "name": "man biking",
    "keywords": [
      "biking_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🚴‍♀️",
    "name": "woman biking",
    "keywords": [
      "biking_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🚵",
    "name": "person mountain biking",
    "keywords": [
      "mountain_bicyclist"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🚵‍♂️",
    "name": "man mountain biking",
    "keywords": [
      "mountain_biking_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🚵‍♀️",
    "name": "woman mountain biking",
    "keywords": [
      "mountain_biking_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤸",
    "name": "person cartwheeling",
    "keywords": [
      "cartwheeling"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤸‍♂️",
    "name": "man cartwheeling",
    "keywords": [
      "man_cartwheeling"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤸‍♀️",
    "name": "woman cartwheeling",
    "keywords": [
      "woman_cartwheeling"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤼",
    "name": "people wrestling",
    "keywords": [
      "wrestling"
    ],
    "category": "people"
  },
  {
    "glyph": "🤼‍♂️",
    "name": "men wrestling",
    "keywords": [
      "men_wrestling"
    ],
    "category": "people"
  },
  {
    "glyph": "🤼‍♀️",
    "name": "women wrestling",
    "keywords": [
      "women_wrestling"
    ],
    "category": "people"
  },
  {
    "glyph": "🤽",
    "name": "person playing water polo",
    "keywords": [
      "water_polo"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤽‍♂️",
    "name": "man playing water polo",
    "keywords": [
      "man_playing_water_polo"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤽‍♀️",
    "name": "woman playing water polo",
    "keywords": [
      "woman_playing_water_polo"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤾",
    "name": "person playing handball",
    "keywords": [
      "handball_person"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤾‍♂️",
    "name": "man playing handball",
    "keywords": [
      "man_playing_handball"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤾‍♀️",
    "name": "woman playing handball",
    "keywords": [
      "woman_playing_handball"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤹",
    "name": "person juggling",
    "keywords": [
      "juggling_person"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤹‍♂️",
    "name": "man juggling",
    "keywords": [
      "man_juggling"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🤹‍♀️",
    "name": "woman juggling",
    "keywords": [
      "woman_juggling"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧘",
    "name": "person in lotus position",
    "keywords": [
      "lotus_position",
      "meditation"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧘‍♂️",
    "name": "man in lotus position",
    "keywords": [
      "lotus_position_man",
      "meditation"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧘‍♀️",
    "name": "woman in lotus position",
    "keywords": [
      "lotus_position_woman",
      "meditation"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🛀",
    "name": "person taking bath",
    "keywords": [
      "bath",
      "shower"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🛌",
    "name": "person in bed",
    "keywords": [
      "sleeping_bed"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "🧑‍🤝‍🧑",
    "name": "people holding hands",
    "keywords": [
      "people_holding_hands",
      "couple",
      "date"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👭",
    "name": "women holding hands",
    "keywords": [
      "two_women_holding_hands",
      "couple",
      "date"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👫",
    "name": "woman and man holding hands",
    "keywords": [
      "couple",
      "date"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👬",
    "name": "men holding hands",
    "keywords": [
      "two_men_holding_hands",
      "couple",
      "date"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "💏",
    "name": "kiss",
    "keywords": [
      "couplekiss"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍❤️‍💋‍👨",
    "name": "kiss: woman, man",
    "keywords": [
      "couplekiss_man_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍❤️‍💋‍👨",
    "name": "kiss: man, man",
    "keywords": [
      "couplekiss_man_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍❤️‍💋‍👩",
    "name": "kiss: woman, woman",
    "keywords": [
      "couplekiss_woman_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "💑",
    "name": "couple with heart",
    "keywords": [
      "couple_with_heart"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍❤️‍👨",
    "name": "couple with heart: woman, man",
    "keywords": [
      "couple_with_heart_woman_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👨‍❤️‍👨",
    "name": "couple with heart: man, man",
    "keywords": [
      "couple_with_heart_man_man"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👩‍❤️‍👩",
    "name": "couple with heart: woman, woman",
    "keywords": [
      "couple_with_heart_woman_woman"
    ],
    "category": "people",
    "skinnable": true
  },
  {
    "glyph": "👪",
    "name": "family",
    "keywords": [
      "family",
      "home",
      "parents",
      "child"
    ],
    "category": "people"
  },
  {
    "glyph": "👨‍👩‍👦",
    "name": "family: man, woman, boy",
    "keywords": [
      "family_man_woman_boy"
    ],
    "category": "people"
  },
  {
    "glyph": "👨‍👩‍👧",
    "name": "family: man, woman, girl",
    "keywords": [
      "family_man_woman_girl"
    ],
    "category": "people"
  },
  {
    "glyph": "👨‍👩‍👧‍👦",
    "name": "family: man, woman, girl, boy",
    "keywords": [
      "family_man_woman_girl_boy"
    ],
    "category": "people"
  },
  {
    "glyph": "👨‍👩‍👦‍👦",
    "name": "family: man, woman, boy, boy",
    "keywords": [
      "family_man_woman_boy_boy"
    ],
    "category": "people"
  },
  {
    "glyph": "👨‍👩‍👧‍👧",
    "name": "family: man, woman, girl, girl",
    "keywords": [
      "family_man_woman_girl_girl"
    ],
    "category": "people"
  },
  {
    "glyph": "👨‍👨‍👦",
    "name": "family: man, man, boy",
    "keywords": [
      "family_man_man_boy"
    ],
    "category": "people"
  },
  {
    "glyph": "👨‍👨‍👧",
    "name": "family: man, man, girl",
    "keywords": [
      "family_man_man_girl"
    ],
    "category": "people"
  },
  {
    "glyph": "👨‍👨‍👧‍👦",
    "name": "family: man, man, girl, boy",
    "keywords": [
      "family_man_man_girl_boy"
    ],
    "category": "people"
  },
  {
    "glyph": "👨‍👨‍👦‍👦",
    "name": "family: man, man, boy, boy",
    "keywords": [
      "family_man_man_boy_boy"
    ],
    "category": "people"
  },
  {
    "glyph": "👨‍👨‍👧‍👧",
    "name": "family: man, man, girl, girl",
    "keywords": [
      "family_man_man_girl_girl"
    ],
    "category": "people"
  },
  {
    "glyph": "👩‍👩‍👦",
    "name": "family: woman, woman, boy",
    "keywords": [
      "family_woman_woman_boy"
    ],
    "category": "people"
  },
  {
    "glyph": "👩‍👩‍👧",
    "name": "family: woman, woman, girl",
    "keywords": [
      "family_woman_woman_girl"
    ],
    "category": "people"
  },
  {
    "glyph": "👩‍👩‍👧‍👦",
    "name": "family: woman, woman, girl, boy",
    "keywords": [
      "family_woman_woman_girl_boy"
    ],
    "category": "people"
  },
  {
    "glyph": "👩‍👩‍👦‍👦",
    "name": "family: woman, woman, boy, boy",
    "keywords": [
      "family_woman_woman_boy_boy"
    ],
    "category": "people"
  },
  {
    "glyph": "👩‍👩‍👧‍👧",
    "name": "family: woman, woman, girl, girl",
    "keywords": [
      "family_woman_woman_girl_girl"
    ],
    "category": "people"
  },
  {
    "glyph": "👨‍👦",
    "name": "family: man, boy",
    "keywords": [
      "family_man_boy"
    ],
    "category": "people"
  },
  {
    "glyph": "👨‍👦‍👦",
    "name": "family: man, boy, boy",
    "keywords": [
      "family_man_boy_boy"
    ],
    "category": "people"
  },
  {
    "glyph": "👨‍👧",
    "name": "family: man, girl",
    "keywords": [
      "family_man_girl"
    ],
    "category": "people"
  },
  {
    "glyph": "👨‍👧‍👦",
    "name": "family: man, girl, boy",
    "keywords": [
      "family_man_girl_boy"
    ],
    "category": "people"
  },
  {
    "glyph": "👨‍👧‍👧",
    "name": "family: man, girl, girl",
    "keywords": [
      "family_man_girl_girl"
    ],
    "category": "people"
  },
  {
    "glyph": "👩‍👦",
    "name": "family: woman, boy",
    "keywords": [
      "family_woman_boy"
    ],
    "category": "people"
  },
  {
    "glyph": "👩‍👦‍👦",
    "name": "family: woman, boy, boy",
    "keywords": [
      "family_woman_boy_boy"
    ],
    "category": "people"
  },
  {
    "glyph": "👩‍👧",
    "name": "family: woman, girl",
    "keywords": [
      "family_woman_girl"
    ],
    "category": "people"
  },
  {
    "glyph": "👩‍👧‍👦",
    "name": "family: woman, girl, boy",
    "keywords": [
      "family_woman_girl_boy"
    ],
    "category": "people"
  },
  {
    "glyph": "👩‍👧‍👧",
    "name": "family: woman, girl, girl",
    "keywords": [
      "family_woman_girl_girl"
    ],
    "category": "people"
  },
  {
    "glyph": "🗣️",
    "name": "speaking head",
    "keywords": [
      "speaking_head"
    ],
    "category": "people"
  },
  {
    "glyph": "👤",
    "name": "bust in silhouette",
    "keywords": [
      "bust_in_silhouette",
      "user"
    ],
    "category": "people"
  },
  {
    "glyph": "👥",
    "name": "busts in silhouette",
    "keywords": [
      "busts_in_silhouette",
      "users",
      "group",
      "team"
    ],
    "category": "people"
  },
  {
    "glyph": "🫂",
    "name": "people hugging",
    "keywords": [
      "people_hugging"
    ],
    "category": "people"
  },
  {
    "glyph": "👣",
    "name": "footprints",
    "keywords": [
      "footprints",
      "feet",
      "tracks"
    ],
    "category": "people"
  },
  {
    "glyph": "🐵",
    "name": "monkey face",
    "keywords": [
      "monkey_face"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐒",
    "name": "monkey",
    "keywords": [
      "monkey"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦍",
    "name": "gorilla",
    "keywords": [
      "gorilla"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦧",
    "name": "orangutan",
    "keywords": [
      "orangutan"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐶",
    "name": "dog face",
    "keywords": [
      "dog",
      "pet"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐕",
    "name": "dog",
    "keywords": [
      "dog2"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦮",
    "name": "guide dog",
    "keywords": [
      "guide_dog"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐕‍🦺",
    "name": "service dog",
    "keywords": [
      "service_dog"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐩",
    "name": "poodle",
    "keywords": [
      "poodle",
      "dog"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐺",
    "name": "wolf",
    "keywords": [
      "wolf"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦊",
    "name": "fox",
    "keywords": [
      "fox_face"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦝",
    "name": "raccoon",
    "keywords": [
      "raccoon"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐱",
    "name": "cat face",
    "keywords": [
      "cat",
      "pet"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐈",
    "name": "cat",
    "keywords": [
      "cat2"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐈‍⬛",
    "name": "black cat",
    "keywords": [
      "black_cat"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦁",
    "name": "lion",
    "keywords": [
      "lion"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐯",
    "name": "tiger face",
    "keywords": [
      "tiger"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐅",
    "name": "tiger",
    "keywords": [
      "tiger2"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐆",
    "name": "leopard",
    "keywords": [
      "leopard"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐴",
    "name": "horse face",
    "keywords": [
      "horse"
    ],
    "category": "animals"
  },
  {
    "glyph": "🫎",
    "name": "moose",
    "keywords": [
      "moose",
      "canada"
    ],
    "category": "animals"
  },
  {
    "glyph": "🫏",
    "name": "donkey",
    "keywords": [
      "donkey",
      "mule"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐎",
    "name": "horse",
    "keywords": [
      "racehorse",
      "speed"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦄",
    "name": "unicorn",
    "keywords": [
      "unicorn"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦓",
    "name": "zebra",
    "keywords": [
      "zebra"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦌",
    "name": "deer",
    "keywords": [
      "deer"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦬",
    "name": "bison",
    "keywords": [
      "bison"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐮",
    "name": "cow face",
    "keywords": [
      "cow"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐂",
    "name": "ox",
    "keywords": [
      "ox"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐃",
    "name": "water buffalo",
    "keywords": [
      "water_buffalo"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐄",
    "name": "cow",
    "keywords": [
      "cow2"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐷",
    "name": "pig face",
    "keywords": [
      "pig"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐖",
    "name": "pig",
    "keywords": [
      "pig2"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐗",
    "name": "boar",
    "keywords": [
      "boar"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐽",
    "name": "pig nose",
    "keywords": [
      "pig_nose"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐏",
    "name": "ram",
    "keywords": [
      "ram"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐑",
    "name": "ewe",
    "keywords": [
      "sheep"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐐",
    "name": "goat",
    "keywords": [
      "goat"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐪",
    "name": "camel",
    "keywords": [
      "dromedary_camel",
      "desert"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐫",
    "name": "two-hump camel",
    "keywords": [
      "camel"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦙",
    "name": "llama",
    "keywords": [
      "llama"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦒",
    "name": "giraffe",
    "keywords": [
      "giraffe"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐘",
    "name": "elephant",
    "keywords": [
      "elephant"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦣",
    "name": "mammoth",
    "keywords": [
      "mammoth"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦏",
    "name": "rhinoceros",
    "keywords": [
      "rhinoceros"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦛",
    "name": "hippopotamus",
    "keywords": [
      "hippopotamus"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐭",
    "name": "mouse face",
    "keywords": [
      "mouse"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐁",
    "name": "mouse",
    "keywords": [
      "mouse2"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐀",
    "name": "rat",
    "keywords": [
      "rat"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐹",
    "name": "hamster",
    "keywords": [
      "hamster",
      "pet"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐰",
    "name": "rabbit face",
    "keywords": [
      "rabbit",
      "bunny"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐇",
    "name": "rabbit",
    "keywords": [
      "rabbit2"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐿️",
    "name": "chipmunk",
    "keywords": [
      "chipmunk"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦫",
    "name": "beaver",
    "keywords": [
      "beaver"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦔",
    "name": "hedgehog",
    "keywords": [
      "hedgehog"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦇",
    "name": "bat",
    "keywords": [
      "bat"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐻",
    "name": "bear",
    "keywords": [
      "bear"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐻‍❄️",
    "name": "polar bear",
    "keywords": [
      "polar_bear"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐨",
    "name": "koala",
    "keywords": [
      "koala"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐼",
    "name": "panda",
    "keywords": [
      "panda_face"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦥",
    "name": "sloth",
    "keywords": [
      "sloth"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦦",
    "name": "otter",
    "keywords": [
      "otter"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦨",
    "name": "skunk",
    "keywords": [
      "skunk"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦘",
    "name": "kangaroo",
    "keywords": [
      "kangaroo"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦡",
    "name": "badger",
    "keywords": [
      "badger"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐾",
    "name": "paw prints",
    "keywords": [
      "feet",
      "paw_prints"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦃",
    "name": "turkey",
    "keywords": [
      "turkey",
      "thanksgiving"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐔",
    "name": "chicken",
    "keywords": [
      "chicken"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐓",
    "name": "rooster",
    "keywords": [
      "rooster"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐣",
    "name": "hatching chick",
    "keywords": [
      "hatching_chick"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐤",
    "name": "baby chick",
    "keywords": [
      "baby_chick"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐥",
    "name": "front-facing baby chick",
    "keywords": [
      "hatched_chick"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐦",
    "name": "bird",
    "keywords": [
      "bird"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐧",
    "name": "penguin",
    "keywords": [
      "penguin"
    ],
    "category": "animals"
  },
  {
    "glyph": "🕊️",
    "name": "dove",
    "keywords": [
      "dove",
      "peace"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦅",
    "name": "eagle",
    "keywords": [
      "eagle"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦆",
    "name": "duck",
    "keywords": [
      "duck"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦢",
    "name": "swan",
    "keywords": [
      "swan"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦉",
    "name": "owl",
    "keywords": [
      "owl"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦤",
    "name": "dodo",
    "keywords": [
      "dodo"
    ],
    "category": "animals"
  },
  {
    "glyph": "🪶",
    "name": "feather",
    "keywords": [
      "feather"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦩",
    "name": "flamingo",
    "keywords": [
      "flamingo"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦚",
    "name": "peacock",
    "keywords": [
      "peacock"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦜",
    "name": "parrot",
    "keywords": [
      "parrot"
    ],
    "category": "animals"
  },
  {
    "glyph": "🪽",
    "name": "wing",
    "keywords": [
      "wing",
      "fly"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐦‍⬛",
    "name": "black bird",
    "keywords": [
      "black_bird"
    ],
    "category": "animals"
  },
  {
    "glyph": "🪿",
    "name": "goose",
    "keywords": [
      "goose",
      "honk"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐸",
    "name": "frog",
    "keywords": [
      "frog"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐊",
    "name": "crocodile",
    "keywords": [
      "crocodile"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐢",
    "name": "turtle",
    "keywords": [
      "turtle",
      "slow"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦎",
    "name": "lizard",
    "keywords": [
      "lizard"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐍",
    "name": "snake",
    "keywords": [
      "snake"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐲",
    "name": "dragon face",
    "keywords": [
      "dragon_face"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐉",
    "name": "dragon",
    "keywords": [
      "dragon"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦕",
    "name": "sauropod",
    "keywords": [
      "sauropod",
      "dinosaur"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦖",
    "name": "T-Rex",
    "keywords": [
      "t-rex",
      "dinosaur"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐳",
    "name": "spouting whale",
    "keywords": [
      "whale",
      "sea"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐋",
    "name": "whale",
    "keywords": [
      "whale2"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐬",
    "name": "dolphin",
    "keywords": [
      "dolphin",
      "flipper"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦭",
    "name": "seal",
    "keywords": [
      "seal"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐟",
    "name": "fish",
    "keywords": [
      "fish"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐠",
    "name": "tropical fish",
    "keywords": [
      "tropical_fish"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐡",
    "name": "blowfish",
    "keywords": [
      "blowfish"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦈",
    "name": "shark",
    "keywords": [
      "shark"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐙",
    "name": "octopus",
    "keywords": [
      "octopus"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐚",
    "name": "spiral shell",
    "keywords": [
      "shell",
      "sea",
      "beach"
    ],
    "category": "animals"
  },
  {
    "glyph": "🪸",
    "name": "coral",
    "keywords": [
      "coral"
    ],
    "category": "animals"
  },
  {
    "glyph": "🪼",
    "name": "jellyfish",
    "keywords": [
      "jellyfish"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐌",
    "name": "snail",
    "keywords": [
      "snail",
      "slow"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦋",
    "name": "butterfly",
    "keywords": [
      "butterfly"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐛",
    "name": "bug",
    "keywords": [
      "bug"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐜",
    "name": "ant",
    "keywords": [
      "ant"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐝",
    "name": "honeybee",
    "keywords": [
      "bee",
      "honeybee"
    ],
    "category": "animals"
  },
  {
    "glyph": "🪲",
    "name": "beetle",
    "keywords": [
      "beetle"
    ],
    "category": "animals"
  },
  {
    "glyph": "🐞",
    "name": "lady beetle",
    "keywords": [
      "lady_beetle",
      "bug"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦗",
    "name": "cricket",
    "keywords": [
      "cricket"
    ],
    "category": "animals"
  },
  {
    "glyph": "🪳",
    "name": "cockroach",
    "keywords": [
      "cockroach"
    ],
    "category": "animals"
  },
  {
    "glyph": "🕷️",
    "name": "spider",
    "keywords": [
      "spider"
    ],
    "category": "animals"
  },
  {
    "glyph": "🕸️",
    "name": "spider web",
    "keywords": [
      "spider_web"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦂",
    "name": "scorpion",
    "keywords": [
      "scorpion"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦟",
    "name": "mosquito",
    "keywords": [
      "mosquito"
    ],
    "category": "animals"
  },
  {
    "glyph": "🪰",
    "name": "fly",
    "keywords": [
      "fly"
    ],
    "category": "animals"
  },
  {
    "glyph": "🪱",
    "name": "worm",
    "keywords": [
      "worm"
    ],
    "category": "animals"
  },
  {
    "glyph": "🦠",
    "name": "microbe",
    "keywords": [
      "microbe",
      "germ"
    ],
    "category": "animals"
  },
  {
    "glyph": "💐",
    "name": "bouquet",
    "keywords": [
      "bouquet",
      "flowers"
    ],
    "category": "animals"
  },
  {
    "glyph": "🌸",
    "name": "cherry blossom",
    "keywords": [
      "cherry_blossom",
      "flower",
      "spring"
    ],
    "category": "animals"
  },
  {
    "glyph": "💮",
    "name": "white flower",
    "keywords": [
      "white_flower"
    ],
    "category": "animals"
  },
  {
    "glyph": "🪷",
    "name": "lotus",
    "keywords": [
      "lotus"
    ],
    "category": "animals"
  },
  {
    "glyph": "🏵️",
    "name": "rosette",
    "keywords": [
      "rosette"
    ],
    "category": "animals"
  },
  {
    "glyph": "🌹",
    "name": "rose",
    "keywords": [
      "rose",
      "flower"
    ],
    "category": "animals"
  },
  {
    "glyph": "🥀",
    "name": "wilted flower",
    "keywords": [
      "wilted_flower"
    ],
    "category": "animals"
  },
  {
    "glyph": "🌺",
    "name": "hibiscus",
    "keywords": [
      "hibiscus"
    ],
    "category": "animals"
  },
  {
    "glyph": "🌻",
    "name": "sunflower",
    "keywords": [
      "sunflower"
    ],
    "category": "animals"
  },
  {
    "glyph": "🌼",
    "name": "blossom",
    "keywords": [
      "blossom"
    ],
    "category": "animals"
  },
  {
    "glyph": "🌷",
    "name": "tulip",
    "keywords": [
      "tulip",
      "flower"
    ],
    "category": "animals"
  },
  {
    "glyph": "🪻",
    "name": "hyacinth",
    "keywords": [
      "hyacinth"
    ],
    "category": "animals"
  },
  {
    "glyph": "🌱",
    "name": "seedling",
    "keywords": [
      "seedling",
      "plant"
    ],
    "category": "animals"
  },
  {
    "glyph": "🪴",
    "name": "potted plant",
    "keywords": [
      "potted_plant"
    ],
    "category": "animals"
  },
  {
    "glyph": "🌲",
    "name": "evergreen tree",
    "keywords": [
      "evergreen_tree",
      "wood"
    ],
    "category": "animals"
  },
  {
    "glyph": "🌳",
    "name": "deciduous tree",
    "keywords": [
      "deciduous_tree",
      "wood"
    ],
    "category": "animals"
  },
  {
    "glyph": "🌴",
    "name": "palm tree",
    "keywords": [
      "palm_tree"
    ],
    "category": "animals"
  },
  {
    "glyph": "🌵",
    "name": "cactus",
    "keywords": [
      "cactus"
    ],
    "category": "animals"
  },
  {
    "glyph": "🌾",
    "name": "sheaf of rice",
    "keywords": [
      "ear_of_rice"
    ],
    "category": "animals"
  },
  {
    "glyph": "🌿",
    "name": "herb",
    "keywords": [
      "herb"
    ],
    "category": "animals"
  },
  {
    "glyph": "☘️",
    "name": "shamrock",
    "keywords": [
      "shamrock"
    ],
    "category": "animals"
  },
  {
    "glyph": "🍀",
    "name": "four leaf clover",
    "keywords": [
      "four_leaf_clover",
      "luck"
    ],
    "category": "animals"
  },
  {
    "glyph": "🍁",
    "name": "maple leaf",
    "keywords": [
      "maple_leaf",
      "canada"
    ],
    "category": "animals"
  },
  {
    "glyph": "🍂",
    "name": "fallen leaf",
    "keywords": [
      "fallen_leaf",
      "autumn"
    ],
    "category": "animals"
  },
  {
    "glyph": "🍃",
    "name": "leaf fluttering in wind",
    "keywords": [
      "leaves",
      "leaf"
    ],
    "category": "animals"
  },
  {
    "glyph": "🪹",
    "name": "empty nest",
    "keywords": [
      "empty_nest"
    ],
    "category": "animals"
  },
  {
    "glyph": "🪺",
    "name": "nest with eggs",
    "keywords": [
      "nest_with_eggs"
    ],
    "category": "animals"
  },
  {
    "glyph": "🍄",
    "name": "mushroom",
    "keywords": [
      "mushroom",
      "fungus"
    ],
    "category": "animals"
  },
  {
    "glyph": "🍇",
    "name": "grapes",
    "keywords": [
      "grapes"
    ],
    "category": "food"
  },
  {
    "glyph": "🍈",
    "name": "melon",
    "keywords": [
      "melon"
    ],
    "category": "food"
  },
  {
    "glyph": "🍉",
    "name": "watermelon",
    "keywords": [
      "watermelon"
    ],
    "category": "food"
  },
  {
    "glyph": "🍊",
    "name": "tangerine",
    "keywords": [
      "tangerine",
      "orange",
      "mandarin"
    ],
    "category": "food"
  },
  {
    "glyph": "🍋",
    "name": "lemon",
    "keywords": [
      "lemon"
    ],
    "category": "food"
  },
  {
    "glyph": "🍌",
    "name": "banana",
    "keywords": [
      "banana",
      "fruit"
    ],
    "category": "food"
  },
  {
    "glyph": "🍍",
    "name": "pineapple",
    "keywords": [
      "pineapple"
    ],
    "category": "food"
  },
  {
    "glyph": "🥭",
    "name": "mango",
    "keywords": [
      "mango"
    ],
    "category": "food"
  },
  {
    "glyph": "🍎",
    "name": "red apple",
    "keywords": [
      "apple"
    ],
    "category": "food"
  },
  {
    "glyph": "🍏",
    "name": "green apple",
    "keywords": [
      "green_apple",
      "fruit"
    ],
    "category": "food"
  },
  {
    "glyph": "🍐",
    "name": "pear",
    "keywords": [
      "pear"
    ],
    "category": "food"
  },
  {
    "glyph": "🍑",
    "name": "peach",
    "keywords": [
      "peach"
    ],
    "category": "food"
  },
  {
    "glyph": "🍒",
    "name": "cherries",
    "keywords": [
      "cherries",
      "fruit"
    ],
    "category": "food"
  },
  {
    "glyph": "🍓",
    "name": "strawberry",
    "keywords": [
      "strawberry",
      "fruit"
    ],
    "category": "food"
  },
  {
    "glyph": "🫐",
    "name": "blueberries",
    "keywords": [
      "blueberries"
    ],
    "category": "food"
  },
  {
    "glyph": "🥝",
    "name": "kiwi fruit",
    "keywords": [
      "kiwi_fruit"
    ],
    "category": "food"
  },
  {
    "glyph": "🍅",
    "name": "tomato",
    "keywords": [
      "tomato"
    ],
    "category": "food"
  },
  {
    "glyph": "🫒",
    "name": "olive",
    "keywords": [
      "olive"
    ],
    "category": "food"
  },
  {
    "glyph": "🥥",
    "name": "coconut",
    "keywords": [
      "coconut"
    ],
    "category": "food"
  },
  {
    "glyph": "🥑",
    "name": "avocado",
    "keywords": [
      "avocado"
    ],
    "category": "food"
  },
  {
    "glyph": "🍆",
    "name": "eggplant",
    "keywords": [
      "eggplant",
      "aubergine"
    ],
    "category": "food"
  },
  {
    "glyph": "🥔",
    "name": "potato",
    "keywords": [
      "potato"
    ],
    "category": "food"
  },
  {
    "glyph": "🥕",
    "name": "carrot",
    "keywords": [
      "carrot"
    ],
    "category": "food"
  },
  {
    "glyph": "🌽",
    "name": "ear of corn",
    "keywords": [
      "corn"
    ],
    "category": "food"
  },
  {
    "glyph": "🌶️",
    "name": "hot pepper",
    "keywords": [
      "hot_pepper",
      "spicy"
    ],
    "category": "food"
  },
  {
    "glyph": "🫑",
    "name": "bell pepper",
    "keywords": [
      "bell_pepper"
    ],
    "category": "food"
  },
  {
    "glyph": "🥒",
    "name": "cucumber",
    "keywords": [
      "cucumber"
    ],
    "category": "food"
  },
  {
    "glyph": "🥬",
    "name": "leafy green",
    "keywords": [
      "leafy_green"
    ],
    "category": "food"
  },
  {
    "glyph": "🥦",
    "name": "broccoli",
    "keywords": [
      "broccoli"
    ],
    "category": "food"
  },
  {
    "glyph": "🧄",
    "name": "garlic",
    "keywords": [
      "garlic"
    ],
    "category": "food"
  },
  {
    "glyph": "🧅",
    "name": "onion",
    "keywords": [
      "onion"
    ],
    "category": "food"
  },
  {
    "glyph": "🥜",
    "name": "peanuts",
    "keywords": [
      "peanuts"
    ],
    "category": "food"
  },
  {
    "glyph": "🫘",
    "name": "beans",
    "keywords": [
      "beans"
    ],
    "category": "food"
  },
  {
    "glyph": "🌰",
    "name": "chestnut",
    "keywords": [
      "chestnut"
    ],
    "category": "food"
  },
  {
    "glyph": "🫚",
    "name": "ginger root",
    "keywords": [
      "ginger_root"
    ],
    "category": "food"
  },
  {
    "glyph": "🫛",
    "name": "pea pod",
    "keywords": [
      "pea_pod"
    ],
    "category": "food"
  },
  {
    "glyph": "🍞",
    "name": "bread",
    "keywords": [
      "bread",
      "toast"
    ],
    "category": "food"
  },
  {
    "glyph": "🥐",
    "name": "croissant",
    "keywords": [
      "croissant"
    ],
    "category": "food"
  },
  {
    "glyph": "🥖",
    "name": "baguette bread",
    "keywords": [
      "baguette_bread"
    ],
    "category": "food"
  },
  {
    "glyph": "🫓",
    "name": "flatbread",
    "keywords": [
      "flatbread"
    ],
    "category": "food"
  },
  {
    "glyph": "🥨",
    "name": "pretzel",
    "keywords": [
      "pretzel"
    ],
    "category": "food"
  },
  {
    "glyph": "🥯",
    "name": "bagel",
    "keywords": [
      "bagel"
    ],
    "category": "food"
  },
  {
    "glyph": "🥞",
    "name": "pancakes",
    "keywords": [
      "pancakes"
    ],
    "category": "food"
  },
  {
    "glyph": "🧇",
    "name": "waffle",
    "keywords": [
      "waffle"
    ],
    "category": "food"
  },
  {
    "glyph": "🧀",
    "name": "cheese wedge",
    "keywords": [
      "cheese"
    ],
    "category": "food"
  },
  {
    "glyph": "🍖",
    "name": "meat on bone",
    "keywords": [
      "meat_on_bone"
    ],
    "category": "food"
  },
  {
    "glyph": "🍗",
    "name": "poultry leg",
    "keywords": [
      "poultry_leg",
      "meat",
      "chicken"
    ],
    "category": "food"
  },
  {
    "glyph": "🥩",
    "name": "cut of meat",
    "keywords": [
      "cut_of_meat"
    ],
    "category": "food"
  },
  {
    "glyph": "🥓",
    "name": "bacon",
    "keywords": [
      "bacon"
    ],
    "category": "food"
  },
  {
    "glyph": "🍔",
    "name": "hamburger",
    "keywords": [
      "hamburger",
      "burger"
    ],
    "category": "food"
  },
  {
    "glyph": "🍟",
    "name": "french fries",
    "keywords": [
      "fries"
    ],
    "category": "food"
  },
  {
    "glyph": "🍕",
    "name": "pizza",
    "keywords": [
      "pizza"
    ],
    "category": "food"
  },
  {
    "glyph": "🌭",
    "name": "hot dog",
    "keywords": [
      "hotdog"
    ],
    "category": "food"
  },
  {
    "glyph": "🥪",
    "name": "sandwich",
    "keywords": [
      "sandwich"
    ],
    "category": "food"
  },
  {
    "glyph": "🌮",
    "name": "taco",
    "keywords": [
      "taco"
    ],
    "category": "food"
  },
  {
    "glyph": "🌯",
    "name": "burrito",
    "keywords": [
      "burrito"
    ],
    "category": "food"
  },
  {
    "glyph": "🫔",
    "name": "tamale",
    "keywords": [
      "tamale"
    ],
    "category": "food"
  },
  {
    "glyph": "🥙",
    "name": "stuffed flatbread",
    "keywords": [
      "stuffed_flatbread"
    ],
    "category": "food"
  },
  {
    "glyph": "🧆",
    "name": "falafel",
    "keywords": [
      "falafel"
    ],
    "category": "food"
  },
  {
    "glyph": "🥚",
    "name": "egg",
    "keywords": [
      "egg"
    ],
    "category": "food"
  },
  {
    "glyph": "🍳",
    "name": "cooking",
    "keywords": [
      "fried_egg",
      "breakfast"
    ],
    "category": "food"
  },
  {
    "glyph": "🥘",
    "name": "shallow pan of food",
    "keywords": [
      "shallow_pan_of_food",
      "paella",
      "curry"
    ],
    "category": "food"
  },
  {
    "glyph": "🍲",
    "name": "pot of food",
    "keywords": [
      "stew"
    ],
    "category": "food"
  },
  {
    "glyph": "🫕",
    "name": "fondue",
    "keywords": [
      "fondue"
    ],
    "category": "food"
  },
  {
    "glyph": "🥣",
    "name": "bowl with spoon",
    "keywords": [
      "bowl_with_spoon"
    ],
    "category": "food"
  },
  {
    "glyph": "🥗",
    "name": "green salad",
    "keywords": [
      "green_salad"
    ],
    "category": "food"
  },
  {
    "glyph": "🍿",
    "name": "popcorn",
    "keywords": [
      "popcorn"
    ],
    "category": "food"
  },
  {
    "glyph": "🧈",
    "name": "butter",
    "keywords": [
      "butter"
    ],
    "category": "food"
  },
  {
    "glyph": "🧂",
    "name": "salt",
    "keywords": [
      "salt"
    ],
    "category": "food"
  },
  {
    "glyph": "🥫",
    "name": "canned food",
    "keywords": [
      "canned_food"
    ],
    "category": "food"
  },
  {
    "glyph": "🍱",
    "name": "bento box",
    "keywords": [
      "bento"
    ],
    "category": "food"
  },
  {
    "glyph": "🍘",
    "name": "rice cracker",
    "keywords": [
      "rice_cracker"
    ],
    "category": "food"
  },
  {
    "glyph": "🍙",
    "name": "rice ball",
    "keywords": [
      "rice_ball"
    ],
    "category": "food"
  },
  {
    "glyph": "🍚",
    "name": "cooked rice",
    "keywords": [
      "rice"
    ],
    "category": "food"
  },
  {
    "glyph": "🍛",
    "name": "curry rice",
    "keywords": [
      "curry"
    ],
    "category": "food"
  },
  {
    "glyph": "🍜",
    "name": "steaming bowl",
    "keywords": [
      "ramen",
      "noodle"
    ],
    "category": "food"
  },
  {
    "glyph": "🍝",
    "name": "spaghetti",
    "keywords": [
      "spaghetti",
      "pasta"
    ],
    "category": "food"
  },
  {
    "glyph": "🍠",
    "name": "roasted sweet potato",
    "keywords": [
      "sweet_potato"
    ],
    "category": "food"
  },
  {
    "glyph": "🍢",
    "name": "oden",
    "keywords": [
      "oden"
    ],
    "category": "food"
  },
  {
    "glyph": "🍣",
    "name": "sushi",
    "keywords": [
      "sushi"
    ],
    "category": "food"
  },
  {
    "glyph": "🍤",
    "name": "fried shrimp",
    "keywords": [
      "fried_shrimp",
      "tempura"
    ],
    "category": "food"
  },
  {
    "glyph": "🍥",
    "name": "fish cake with swirl",
    "keywords": [
      "fish_cake"
    ],
    "category": "food"
  },
  {
    "glyph": "🥮",
    "name": "moon cake",
    "keywords": [
      "moon_cake"
    ],
    "category": "food"
  },
  {
    "glyph": "🍡",
    "name": "dango",
    "keywords": [
      "dango"
    ],
    "category": "food"
  },
  {
    "glyph": "🥟",
    "name": "dumpling",
    "keywords": [
      "dumpling"
    ],
    "category": "food"
  },
  {
    "glyph": "🥠",
    "name": "fortune cookie",
    "keywords": [
      "fortune_cookie"
    ],
    "category": "food"
  },
  {
    "glyph": "🥡",
    "name": "takeout box",
    "keywords": [
      "takeout_box"
    ],
    "category": "food"
  },
  {
    "glyph": "🦀",
    "name": "crab",
    "keywords": [
      "crab"
    ],
    "category": "food"
  },
  {
    "glyph": "🦞",
    "name": "lobster",
    "keywords": [
      "lobster"
    ],
    "category": "food"
  },
  {
    "glyph": "🦐",
    "name": "shrimp",
    "keywords": [
      "shrimp"
    ],
    "category": "food"
  },
  {
    "glyph": "🦑",
    "name": "squid",
    "keywords": [
      "squid"
    ],
    "category": "food"
  },
  {
    "glyph": "🦪",
    "name": "oyster",
    "keywords": [
      "oyster"
    ],
    "category": "food"
  },
  {
    "glyph": "🍦",
    "name": "soft ice cream",
    "keywords": [
      "icecream"
    ],
    "category": "food"
  },
  {
    "glyph": "🍧",
    "name": "shaved ice",
    "keywords": [
      "shaved_ice"
    ],
    "category": "food"
  },
  {
    "glyph": "🍨",
    "name": "ice cream",
    "keywords": [
      "ice_cream"
    ],
    "category": "food"
  },
  {
    "glyph": "🍩",
    "name": "doughnut",
    "keywords": [
      "doughnut"
    ],
    "category": "food"
  },
  {
    "glyph": "🍪",
    "name": "cookie",
    "keywords": [
      "cookie"
    ],
    "category": "food"
  },
  {
    "glyph": "🎂",
    "name": "birthday cake",
    "keywords": [
      "birthday",
      "party"
    ],
    "category": "food"
  },
  {
    "glyph": "🍰",
    "name": "shortcake",
    "keywords": [
      "cake",
      "dessert"
    ],
    "category": "food"
  },
  {
    "glyph": "🧁",
    "name": "cupcake",
    "keywords": [
      "cupcake"
    ],
    "category": "food"
  },
  {
    "glyph": "🥧",
    "name": "pie",
    "keywords": [
      "pie"
    ],
    "category": "food"
  },
  {
    "glyph": "🍫",
    "name": "chocolate bar",
    "keywords": [
      "chocolate_bar"
    ],
    "category": "food"
  },
  {
    "glyph": "🍬",
    "name": "candy",
    "keywords": [
      "candy",
      "sweet"
    ],
    "category": "food"
  },
  {
    "glyph": "🍭",
    "name": "lollipop",
    "keywords": [
      "lollipop"
    ],
    "category": "food"
  },
  {
    "glyph": "🍮",
    "name": "custard",
    "keywords": [
      "custard"
    ],
    "category": "food"
  },
  {
    "glyph": "🍯",
    "name": "honey pot",
    "keywords": [
      "honey_pot"
    ],
    "category": "food"
  },
  {
    "glyph": "🍼",
    "name": "baby bottle",
    "keywords": [
      "baby_bottle",
      "milk"
    ],
    "category": "food"
  },
  {
    "glyph": "🥛",
    "name": "glass of milk",
    "keywords": [
      "milk_glass"
    ],
    "category": "food"
  },
  {
    "glyph": "☕",
    "name": "hot beverage",
    "keywords": [
      "coffee",
      "cafe",
      "espresso"
    ],
    "category": "food"
  },
  {
    "glyph": "🫖",
    "name": "teapot",
    "keywords": [
      "teapot"
    ],
    "category": "food"
  },
  {
    "glyph": "🍵",
    "name": "teacup without handle",
    "keywords": [
      "tea",
      "green",
      "breakfast"
    ],
    "category": "food"
  },
  {
    "glyph": "🍶",
    "name": "sake",
    "keywords": [
      "sake"
    ],
    "category": "food"
  },
  {
    "glyph": "🍾",
    "name": "bottle with popping cork",
    "keywords": [
      "champagne",
      "bottle",
      "bubbly",
      "celebration"
    ],
    "category": "food"
  },
  {
    "glyph": "🍷",
    "name": "wine glass",
    "keywords": [
      "wine_glass"
    ],
    "category": "food"
  },
  {
    "glyph": "🍸",
    "name": "cocktail glass",
    "keywords": [
      "cocktail",
      "drink"
    ],
    "category": "food"
  },
  {
    "glyph": "🍹",
    "name": "tropical drink",
    "keywords": [
      "tropical_drink",
      "summer",
      "vacation"
    ],
    "category": "food"
  },
  {
    "glyph": "🍺",
    "name": "beer mug",
    "keywords": [
      "beer",
      "drink"
    ],
    "category": "food"
  },
  {
    "glyph": "🍻",
    "name": "clinking beer mugs",
    "keywords": [
      "beers",
      "drinks"
    ],
    "category": "food"
  },
  {
    "glyph": "🥂",
    "name": "clinking glasses",
    "keywords": [
      "clinking_glasses",
      "cheers",
      "toast"
    ],
    "category": "food"
  },
  {
    "glyph": "🥃",
    "name": "tumbler glass",
    "keywords": [
      "tumbler_glass",
      "whisky"
    ],
    "category": "food"
  },
  {
    "glyph": "🫗",
    "name": "pouring liquid",
    "keywords": [
      "pouring_liquid"
    ],
    "category": "food"
  },
  {
    "glyph": "🥤",
    "name": "cup with straw",
    "keywords": [
      "cup_with_straw"
    ],
    "category": "food"
  },
  {
    "glyph": "🧋",
    "name": "bubble tea",
    "keywords": [
      "bubble_tea"
    ],
    "category": "food"
  },
  {
    "glyph": "🧃",
    "name": "beverage box",
    "keywords": [
      "beverage_box"
    ],
    "category": "food"
  },
  {
    "glyph": "🧉",
    "name": "mate",
    "keywords": [
      "mate"
    ],
    "category": "food"
  },
  {
    "glyph": "🧊",
    "name": "ice",
    "keywords": [
      "ice_cube"
    ],
    "category": "food"
  },
  {
    "glyph": "🥢",
    "name": "chopsticks",
    "keywords": [
      "chopsticks"
    ],
    "category": "food"
  },
  {
    "glyph": "🍽️",
    "name": "fork and knife with plate",
    "keywords": [
      "plate_with_cutlery",
      "dining",
      "dinner"
    ],
    "category": "food"
  },
  {
    "glyph": "🍴",
    "name": "fork and knife",
    "keywords": [
      "fork_and_knife",
      "cutlery"
    ],
    "category": "food"
  },
  {
    "glyph": "🥄",
    "name": "spoon",
    "keywords": [
      "spoon"
    ],
    "category": "food"
  },
  {
    "glyph": "🔪",
    "name": "kitchen knife",
    "keywords": [
      "hocho",
      "knife",
      "cut",
      "chop"
    ],
    "category": "food"
  },
  {
    "glyph": "🫙",
    "name": "jar",
    "keywords": [
      "jar"
    ],
    "category": "food"
  },
  {
    "glyph": "🏺",
    "name": "amphora",
    "keywords": [
      "amphora"
    ],
    "category": "food"
  },
  {
    "glyph": "🌍",
    "name": "globe showing Europe-Africa",
    "keywords": [
      "earth_africa",
      "globe",
      "world",
      "international"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌎",
    "name": "globe showing Americas",
    "keywords": [
      "earth_americas",
      "globe",
      "world",
      "international"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌏",
    "name": "globe showing Asia-Australia",
    "keywords": [
      "earth_asia",
      "globe",
      "world",
      "international"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌐",
    "name": "globe with meridians",
    "keywords": [
      "globe_with_meridians",
      "world",
      "global",
      "international"
    ],
    "category": "travel"
  },
  {
    "glyph": "🗺️",
    "name": "world map",
    "keywords": [
      "world_map",
      "travel"
    ],
    "category": "travel"
  },
  {
    "glyph": "🗾",
    "name": "map of Japan",
    "keywords": [
      "japan"
    ],
    "category": "travel"
  },
  {
    "glyph": "🧭",
    "name": "compass",
    "keywords": [
      "compass"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏔️",
    "name": "snow-capped mountain",
    "keywords": [
      "mountain_snow"
    ],
    "category": "travel"
  },
  {
    "glyph": "⛰️",
    "name": "mountain",
    "keywords": [
      "mountain"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌋",
    "name": "volcano",
    "keywords": [
      "volcano"
    ],
    "category": "travel"
  },
  {
    "glyph": "🗻",
    "name": "mount fuji",
    "keywords": [
      "mount_fuji"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏕️",
    "name": "camping",
    "keywords": [
      "camping"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏖️",
    "name": "beach with umbrella",
    "keywords": [
      "beach_umbrella"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏜️",
    "name": "desert",
    "keywords": [
      "desert"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏝️",
    "name": "desert island",
    "keywords": [
      "desert_island"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏞️",
    "name": "national park",
    "keywords": [
      "national_park"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏟️",
    "name": "stadium",
    "keywords": [
      "stadium"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏛️",
    "name": "classical building",
    "keywords": [
      "classical_building"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏗️",
    "name": "building construction",
    "keywords": [
      "building_construction"
    ],
    "category": "travel"
  },
  {
    "glyph": "🧱",
    "name": "brick",
    "keywords": [
      "bricks"
    ],
    "category": "travel"
  },
  {
    "glyph": "🪨",
    "name": "rock",
    "keywords": [
      "rock"
    ],
    "category": "travel"
  },
  {
    "glyph": "🪵",
    "name": "wood",
    "keywords": [
      "wood"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛖",
    "name": "hut",
    "keywords": [
      "hut"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏘️",
    "name": "houses",
    "keywords": [
      "houses"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏚️",
    "name": "derelict house",
    "keywords": [
      "derelict_house"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏠",
    "name": "house",
    "keywords": [
      "house"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏡",
    "name": "house with garden",
    "keywords": [
      "house_with_garden"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏢",
    "name": "office building",
    "keywords": [
      "office"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏣",
    "name": "Japanese post office",
    "keywords": [
      "post_office"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏤",
    "name": "post office",
    "keywords": [
      "european_post_office"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏥",
    "name": "hospital",
    "keywords": [
      "hospital"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏦",
    "name": "bank",
    "keywords": [
      "bank"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏨",
    "name": "hotel",
    "keywords": [
      "hotel"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏩",
    "name": "love hotel",
    "keywords": [
      "love_hotel"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏪",
    "name": "convenience store",
    "keywords": [
      "convenience_store"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏫",
    "name": "school",
    "keywords": [
      "school"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏬",
    "name": "department store",
    "keywords": [
      "department_store"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏭",
    "name": "factory",
    "keywords": [
      "factory"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏯",
    "name": "Japanese castle",
    "keywords": [
      "japanese_castle"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏰",
    "name": "castle",
    "keywords": [
      "european_castle"
    ],
    "category": "travel"
  },
  {
    "glyph": "💒",
    "name": "wedding",
    "keywords": [
      "wedding",
      "marriage"
    ],
    "category": "travel"
  },
  {
    "glyph": "🗼",
    "name": "Tokyo tower",
    "keywords": [
      "tokyo_tower"
    ],
    "category": "travel"
  },
  {
    "glyph": "🗽",
    "name": "Statue of Liberty",
    "keywords": [
      "statue_of_liberty"
    ],
    "category": "travel"
  },
  {
    "glyph": "⛪",
    "name": "church",
    "keywords": [
      "church"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕌",
    "name": "mosque",
    "keywords": [
      "mosque"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛕",
    "name": "hindu temple",
    "keywords": [
      "hindu_temple"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕍",
    "name": "synagogue",
    "keywords": [
      "synagogue"
    ],
    "category": "travel"
  },
  {
    "glyph": "⛩️",
    "name": "shinto shrine",
    "keywords": [
      "shinto_shrine"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕋",
    "name": "kaaba",
    "keywords": [
      "kaaba"
    ],
    "category": "travel"
  },
  {
    "glyph": "⛲",
    "name": "fountain",
    "keywords": [
      "fountain"
    ],
    "category": "travel"
  },
  {
    "glyph": "⛺",
    "name": "tent",
    "keywords": [
      "tent",
      "camping"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌁",
    "name": "foggy",
    "keywords": [
      "foggy",
      "karl"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌃",
    "name": "night with stars",
    "keywords": [
      "night_with_stars"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏙️",
    "name": "cityscape",
    "keywords": [
      "cityscape",
      "skyline"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌄",
    "name": "sunrise over mountains",
    "keywords": [
      "sunrise_over_mountains"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌅",
    "name": "sunrise",
    "keywords": [
      "sunrise"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌆",
    "name": "cityscape at dusk",
    "keywords": [
      "city_sunset"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌇",
    "name": "sunset",
    "keywords": [
      "city_sunrise"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌉",
    "name": "bridge at night",
    "keywords": [
      "bridge_at_night"
    ],
    "category": "travel"
  },
  {
    "glyph": "♨️",
    "name": "hot springs",
    "keywords": [
      "hotsprings"
    ],
    "category": "travel"
  },
  {
    "glyph": "🎠",
    "name": "carousel horse",
    "keywords": [
      "carousel_horse"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛝",
    "name": "playground slide",
    "keywords": [
      "playground_slide"
    ],
    "category": "travel"
  },
  {
    "glyph": "🎡",
    "name": "ferris wheel",
    "keywords": [
      "ferris_wheel"
    ],
    "category": "travel"
  },
  {
    "glyph": "🎢",
    "name": "roller coaster",
    "keywords": [
      "roller_coaster"
    ],
    "category": "travel"
  },
  {
    "glyph": "💈",
    "name": "barber pole",
    "keywords": [
      "barber"
    ],
    "category": "travel"
  },
  {
    "glyph": "🎪",
    "name": "circus tent",
    "keywords": [
      "circus_tent"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚂",
    "name": "locomotive",
    "keywords": [
      "steam_locomotive",
      "train"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚃",
    "name": "railway car",
    "keywords": [
      "railway_car"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚄",
    "name": "high-speed train",
    "keywords": [
      "bullettrain_side",
      "train"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚅",
    "name": "bullet train",
    "keywords": [
      "bullettrain_front",
      "train"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚆",
    "name": "train",
    "keywords": [
      "train2"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚇",
    "name": "metro",
    "keywords": [
      "metro"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚈",
    "name": "light rail",
    "keywords": [
      "light_rail"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚉",
    "name": "station",
    "keywords": [
      "station"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚊",
    "name": "tram",
    "keywords": [
      "tram"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚝",
    "name": "monorail",
    "keywords": [
      "monorail"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚞",
    "name": "mountain railway",
    "keywords": [
      "mountain_railway"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚋",
    "name": "tram car",
    "keywords": [
      "train"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚌",
    "name": "bus",
    "keywords": [
      "bus"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚍",
    "name": "oncoming bus",
    "keywords": [
      "oncoming_bus"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚎",
    "name": "trolleybus",
    "keywords": [
      "trolleybus"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚐",
    "name": "minibus",
    "keywords": [
      "minibus"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚑",
    "name": "ambulance",
    "keywords": [
      "ambulance"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚒",
    "name": "fire engine",
    "keywords": [
      "fire_engine"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚓",
    "name": "police car",
    "keywords": [
      "police_car"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚔",
    "name": "oncoming police car",
    "keywords": [
      "oncoming_police_car"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚕",
    "name": "taxi",
    "keywords": [
      "taxi"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚖",
    "name": "oncoming taxi",
    "keywords": [
      "oncoming_taxi"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚗",
    "name": "automobile",
    "keywords": [
      "car",
      "red_car"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚘",
    "name": "oncoming automobile",
    "keywords": [
      "oncoming_automobile"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚙",
    "name": "sport utility vehicle",
    "keywords": [
      "blue_car"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛻",
    "name": "pickup truck",
    "keywords": [
      "pickup_truck"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚚",
    "name": "delivery truck",
    "keywords": [
      "truck"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚛",
    "name": "articulated lorry",
    "keywords": [
      "articulated_lorry"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚜",
    "name": "tractor",
    "keywords": [
      "tractor"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏎️",
    "name": "racing car",
    "keywords": [
      "racing_car"
    ],
    "category": "travel"
  },
  {
    "glyph": "🏍️",
    "name": "motorcycle",
    "keywords": [
      "motorcycle"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛵",
    "name": "motor scooter",
    "keywords": [
      "motor_scooter"
    ],
    "category": "travel"
  },
  {
    "glyph": "🦽",
    "name": "manual wheelchair",
    "keywords": [
      "manual_wheelchair"
    ],
    "category": "travel"
  },
  {
    "glyph": "🦼",
    "name": "motorized wheelchair",
    "keywords": [
      "motorized_wheelchair"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛺",
    "name": "auto rickshaw",
    "keywords": [
      "auto_rickshaw"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚲",
    "name": "bicycle",
    "keywords": [
      "bike",
      "bicycle"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛴",
    "name": "kick scooter",
    "keywords": [
      "kick_scooter"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛹",
    "name": "skateboard",
    "keywords": [
      "skateboard"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛼",
    "name": "roller skate",
    "keywords": [
      "roller_skate"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚏",
    "name": "bus stop",
    "keywords": [
      "busstop"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛣️",
    "name": "motorway",
    "keywords": [
      "motorway"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛤️",
    "name": "railway track",
    "keywords": [
      "railway_track"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛢️",
    "name": "oil drum",
    "keywords": [
      "oil_drum"
    ],
    "category": "travel"
  },
  {
    "glyph": "⛽",
    "name": "fuel pump",
    "keywords": [
      "fuelpump"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛞",
    "name": "wheel",
    "keywords": [
      "wheel"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚨",
    "name": "police car light",
    "keywords": [
      "rotating_light",
      "911",
      "emergency"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚥",
    "name": "horizontal traffic light",
    "keywords": [
      "traffic_light"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚦",
    "name": "vertical traffic light",
    "keywords": [
      "vertical_traffic_light",
      "semaphore"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛑",
    "name": "stop sign",
    "keywords": [
      "stop_sign"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚧",
    "name": "construction",
    "keywords": [
      "construction",
      "wip"
    ],
    "category": "travel"
  },
  {
    "glyph": "⚓",
    "name": "anchor",
    "keywords": [
      "anchor",
      "ship"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛟",
    "name": "ring buoy",
    "keywords": [
      "ring_buoy",
      "life preserver"
    ],
    "category": "travel"
  },
  {
    "glyph": "⛵",
    "name": "sailboat",
    "keywords": [
      "boat",
      "sailboat"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛶",
    "name": "canoe",
    "keywords": [
      "canoe"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚤",
    "name": "speedboat",
    "keywords": [
      "speedboat",
      "ship"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛳️",
    "name": "passenger ship",
    "keywords": [
      "passenger_ship",
      "cruise"
    ],
    "category": "travel"
  },
  {
    "glyph": "⛴️",
    "name": "ferry",
    "keywords": [
      "ferry"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛥️",
    "name": "motor boat",
    "keywords": [
      "motor_boat"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚢",
    "name": "ship",
    "keywords": [
      "ship"
    ],
    "category": "travel"
  },
  {
    "glyph": "✈️",
    "name": "airplane",
    "keywords": [
      "airplane",
      "flight"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛩️",
    "name": "small airplane",
    "keywords": [
      "small_airplane",
      "flight"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛫",
    "name": "airplane departure",
    "keywords": [
      "flight_departure"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛬",
    "name": "airplane arrival",
    "keywords": [
      "flight_arrival"
    ],
    "category": "travel"
  },
  {
    "glyph": "🪂",
    "name": "parachute",
    "keywords": [
      "parachute"
    ],
    "category": "travel"
  },
  {
    "glyph": "💺",
    "name": "seat",
    "keywords": [
      "seat"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚁",
    "name": "helicopter",
    "keywords": [
      "helicopter"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚟",
    "name": "suspension railway",
    "keywords": [
      "suspension_railway"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚠",
    "name": "mountain cableway",
    "keywords": [
      "mountain_cableway"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚡",
    "name": "aerial tramway",
    "keywords": [
      "aerial_tramway"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛰️",
    "name": "satellite",
    "keywords": [
      "artificial_satellite",
      "orbit",
      "space"
    ],
    "category": "travel"
  },
  {
    "glyph": "🚀",
    "name": "rocket",
    "keywords": [
      "rocket",
      "ship",
      "launch"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛸",
    "name": "flying saucer",
    "keywords": [
      "flying_saucer",
      "ufo"
    ],
    "category": "travel"
  },
  {
    "glyph": "🛎️",
    "name": "bellhop bell",
    "keywords": [
      "bellhop_bell"
    ],
    "category": "travel"
  },
  {
    "glyph": "🧳",
    "name": "luggage",
    "keywords": [
      "luggage"
    ],
    "category": "travel"
  },
  {
    "glyph": "⌛",
    "name": "hourglass done",
    "keywords": [
      "hourglass",
      "time"
    ],
    "category": "travel"
  },
  {
    "glyph": "⏳",
    "name": "hourglass not done",
    "keywords": [
      "hourglass_flowing_sand",
      "time"
    ],
    "category": "travel"
  },
  {
    "glyph": "⌚",
    "name": "watch",
    "keywords": [
      "watch",
      "time"
    ],
    "category": "travel"
  },
  {
    "glyph": "⏰",
    "name": "alarm clock",
    "keywords": [
      "alarm_clock",
      "morning"
    ],
    "category": "travel"
  },
  {
    "glyph": "⏱️",
    "name": "stopwatch",
    "keywords": [
      "stopwatch"
    ],
    "category": "travel"
  },
  {
    "glyph": "⏲️",
    "name": "timer clock",
    "keywords": [
      "timer_clock"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕰️",
    "name": "mantelpiece clock",
    "keywords": [
      "mantelpiece_clock"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕛",
    "name": "twelve o’clock",
    "keywords": [
      "clock12"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕧",
    "name": "twelve-thirty",
    "keywords": [
      "clock1230"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕐",
    "name": "one o’clock",
    "keywords": [
      "clock1"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕜",
    "name": "one-thirty",
    "keywords": [
      "clock130"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕑",
    "name": "two o’clock",
    "keywords": [
      "clock2"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕝",
    "name": "two-thirty",
    "keywords": [
      "clock230"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕒",
    "name": "three o’clock",
    "keywords": [
      "clock3"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕞",
    "name": "three-thirty",
    "keywords": [
      "clock330"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕓",
    "name": "four o’clock",
    "keywords": [
      "clock4"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕟",
    "name": "four-thirty",
    "keywords": [
      "clock430"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕔",
    "name": "five o’clock",
    "keywords": [
      "clock5"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕠",
    "name": "five-thirty",
    "keywords": [
      "clock530"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕕",
    "name": "six o’clock",
    "keywords": [
      "clock6"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕡",
    "name": "six-thirty",
    "keywords": [
      "clock630"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕖",
    "name": "seven o’clock",
    "keywords": [
      "clock7"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕢",
    "name": "seven-thirty",
    "keywords": [
      "clock730"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕗",
    "name": "eight o’clock",
    "keywords": [
      "clock8"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕣",
    "name": "eight-thirty",
    "keywords": [
      "clock830"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕘",
    "name": "nine o’clock",
    "keywords": [
      "clock9"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕤",
    "name": "nine-thirty",
    "keywords": [
      "clock930"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕙",
    "name": "ten o’clock",
    "keywords": [
      "clock10"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕥",
    "name": "ten-thirty",
    "keywords": [
      "clock1030"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕚",
    "name": "eleven o’clock",
    "keywords": [
      "clock11"
    ],
    "category": "travel"
  },
  {
    "glyph": "🕦",
    "name": "eleven-thirty",
    "keywords": [
      "clock1130"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌑",
    "name": "new moon",
    "keywords": [
      "new_moon"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌒",
    "name": "waxing crescent moon",
    "keywords": [
      "waxing_crescent_moon"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌓",
    "name": "first quarter moon",
    "keywords": [
      "first_quarter_moon"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌔",
    "name": "waxing gibbous moon",
    "keywords": [
      "moon",
      "waxing_gibbous_moon"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌕",
    "name": "full moon",
    "keywords": [
      "full_moon"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌖",
    "name": "waning gibbous moon",
    "keywords": [
      "waning_gibbous_moon"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌗",
    "name": "last quarter moon",
    "keywords": [
      "last_quarter_moon"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌘",
    "name": "waning crescent moon",
    "keywords": [
      "waning_crescent_moon"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌙",
    "name": "crescent moon",
    "keywords": [
      "crescent_moon",
      "night"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌚",
    "name": "new moon face",
    "keywords": [
      "new_moon_with_face"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌛",
    "name": "first quarter moon face",
    "keywords": [
      "first_quarter_moon_with_face"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌜",
    "name": "last quarter moon face",
    "keywords": [
      "last_quarter_moon_with_face"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌡️",
    "name": "thermometer",
    "keywords": [
      "thermometer"
    ],
    "category": "travel"
  },
  {
    "glyph": "☀️",
    "name": "sun",
    "keywords": [
      "sunny",
      "weather"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌝",
    "name": "full moon face",
    "keywords": [
      "full_moon_with_face"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌞",
    "name": "sun with face",
    "keywords": [
      "sun_with_face",
      "summer"
    ],
    "category": "travel"
  },
  {
    "glyph": "🪐",
    "name": "ringed planet",
    "keywords": [
      "ringed_planet"
    ],
    "category": "travel"
  },
  {
    "glyph": "⭐",
    "name": "star",
    "keywords": [
      "star"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌟",
    "name": "glowing star",
    "keywords": [
      "star2"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌠",
    "name": "shooting star",
    "keywords": [
      "stars"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌌",
    "name": "milky way",
    "keywords": [
      "milky_way"
    ],
    "category": "travel"
  },
  {
    "glyph": "☁️",
    "name": "cloud",
    "keywords": [
      "cloud"
    ],
    "category": "travel"
  },
  {
    "glyph": "⛅",
    "name": "sun behind cloud",
    "keywords": [
      "partly_sunny",
      "weather",
      "cloud"
    ],
    "category": "travel"
  },
  {
    "glyph": "⛈️",
    "name": "cloud with lightning and rain",
    "keywords": [
      "cloud_with_lightning_and_rain"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌤️",
    "name": "sun behind small cloud",
    "keywords": [
      "sun_behind_small_cloud"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌥️",
    "name": "sun behind large cloud",
    "keywords": [
      "sun_behind_large_cloud"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌦️",
    "name": "sun behind rain cloud",
    "keywords": [
      "sun_behind_rain_cloud"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌧️",
    "name": "cloud with rain",
    "keywords": [
      "cloud_with_rain"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌨️",
    "name": "cloud with snow",
    "keywords": [
      "cloud_with_snow"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌩️",
    "name": "cloud with lightning",
    "keywords": [
      "cloud_with_lightning"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌪️",
    "name": "tornado",
    "keywords": [
      "tornado"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌫️",
    "name": "fog",
    "keywords": [
      "fog"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌬️",
    "name": "wind face",
    "keywords": [
      "wind_face"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌀",
    "name": "cyclone",
    "keywords": [
      "cyclone",
      "swirl"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌈",
    "name": "rainbow",
    "keywords": [
      "rainbow"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌂",
    "name": "closed umbrella",
    "keywords": [
      "closed_umbrella",
      "weather",
      "rain"
    ],
    "category": "travel"
  },
  {
    "glyph": "☂️",
    "name": "umbrella",
    "keywords": [
      "open_umbrella"
    ],
    "category": "travel"
  },
  {
    "glyph": "☔",
    "name": "umbrella with rain drops",
    "keywords": [
      "umbrella",
      "rain",
      "weather"
    ],
    "category": "travel"
  },
  {
    "glyph": "⛱️",
    "name": "umbrella on ground",
    "keywords": [
      "parasol_on_ground",
      "beach_umbrella"
    ],
    "category": "travel"
  },
  {
    "glyph": "⚡",
    "name": "high voltage",
    "keywords": [
      "zap",
      "lightning",
      "thunder"
    ],
    "category": "travel"
  },
  {
    "glyph": "❄️",
    "name": "snowflake",
    "keywords": [
      "snowflake",
      "winter",
      "cold",
      "weather"
    ],
    "category": "travel"
  },
  {
    "glyph": "☃️",
    "name": "snowman",
    "keywords": [
      "snowman_with_snow",
      "winter",
      "christmas"
    ],
    "category": "travel"
  },
  {
    "glyph": "⛄",
    "name": "snowman without snow",
    "keywords": [
      "snowman",
      "winter"
    ],
    "category": "travel"
  },
  {
    "glyph": "☄️",
    "name": "comet",
    "keywords": [
      "comet"
    ],
    "category": "travel"
  },
  {
    "glyph": "🔥",
    "name": "fire",
    "keywords": [
      "fire",
      "burn"
    ],
    "category": "travel"
  },
  {
    "glyph": "💧",
    "name": "droplet",
    "keywords": [
      "droplet",
      "water"
    ],
    "category": "travel"
  },
  {
    "glyph": "🌊",
    "name": "water wave",
    "keywords": [
      "ocean",
      "sea"
    ],
    "category": "travel"
  },
  {
    "glyph": "🎃",
    "name": "jack-o-lantern",
    "keywords": [
      "jack_o_lantern",
      "halloween"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎄",
    "name": "Christmas tree",
    "keywords": [
      "christmas_tree"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎆",
    "name": "fireworks",
    "keywords": [
      "fireworks",
      "festival",
      "celebration"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎇",
    "name": "sparkler",
    "keywords": [
      "sparkler"
    ],
    "category": "activities"
  },
  {
    "glyph": "🧨",
    "name": "firecracker",
    "keywords": [
      "firecracker"
    ],
    "category": "activities"
  },
  {
    "glyph": "✨",
    "name": "sparkles",
    "keywords": [
      "sparkles",
      "shiny"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎈",
    "name": "balloon",
    "keywords": [
      "balloon",
      "party",
      "birthday"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎉",
    "name": "party popper",
    "keywords": [
      "tada",
      "hooray",
      "party"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎊",
    "name": "confetti ball",
    "keywords": [
      "confetti_ball"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎋",
    "name": "tanabata tree",
    "keywords": [
      "tanabata_tree"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎍",
    "name": "pine decoration",
    "keywords": [
      "bamboo"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎎",
    "name": "Japanese dolls",
    "keywords": [
      "dolls"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎏",
    "name": "carp streamer",
    "keywords": [
      "flags"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎐",
    "name": "wind chime",
    "keywords": [
      "wind_chime"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎑",
    "name": "moon viewing ceremony",
    "keywords": [
      "rice_scene"
    ],
    "category": "activities"
  },
  {
    "glyph": "🧧",
    "name": "red envelope",
    "keywords": [
      "red_envelope"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎀",
    "name": "ribbon",
    "keywords": [
      "ribbon"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎁",
    "name": "wrapped gift",
    "keywords": [
      "gift",
      "present",
      "birthday",
      "christmas"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎗️",
    "name": "reminder ribbon",
    "keywords": [
      "reminder_ribbon"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎟️",
    "name": "admission tickets",
    "keywords": [
      "tickets"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎫",
    "name": "ticket",
    "keywords": [
      "ticket"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎖️",
    "name": "military medal",
    "keywords": [
      "medal_military"
    ],
    "category": "activities"
  },
  {
    "glyph": "🏆",
    "name": "trophy",
    "keywords": [
      "trophy",
      "award",
      "contest",
      "winner"
    ],
    "category": "activities"
  },
  {
    "glyph": "🏅",
    "name": "sports medal",
    "keywords": [
      "medal_sports",
      "gold",
      "winner"
    ],
    "category": "activities"
  },
  {
    "glyph": "🥇",
    "name": "1st place medal",
    "keywords": [
      "1st_place_medal",
      "gold"
    ],
    "category": "activities"
  },
  {
    "glyph": "🥈",
    "name": "2nd place medal",
    "keywords": [
      "2nd_place_medal",
      "silver"
    ],
    "category": "activities"
  },
  {
    "glyph": "🥉",
    "name": "3rd place medal",
    "keywords": [
      "3rd_place_medal",
      "bronze"
    ],
    "category": "activities"
  },
  {
    "glyph": "⚽",
    "name": "soccer ball",
    "keywords": [
      "soccer",
      "sports"
    ],
    "category": "activities"
  },
  {
    "glyph": "⚾",
    "name": "baseball",
    "keywords": [
      "baseball",
      "sports"
    ],
    "category": "activities"
  },
  {
    "glyph": "🥎",
    "name": "softball",
    "keywords": [
      "softball"
    ],
    "category": "activities"
  },
  {
    "glyph": "🏀",
    "name": "basketball",
    "keywords": [
      "basketball",
      "sports"
    ],
    "category": "activities"
  },
  {
    "glyph": "🏐",
    "name": "volleyball",
    "keywords": [
      "volleyball"
    ],
    "category": "activities"
  },
  {
    "glyph": "🏈",
    "name": "american football",
    "keywords": [
      "football",
      "sports"
    ],
    "category": "activities"
  },
  {
    "glyph": "🏉",
    "name": "rugby football",
    "keywords": [
      "rugby_football"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎾",
    "name": "tennis",
    "keywords": [
      "tennis",
      "sports"
    ],
    "category": "activities"
  },
  {
    "glyph": "🥏",
    "name": "flying disc",
    "keywords": [
      "flying_disc"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎳",
    "name": "bowling",
    "keywords": [
      "bowling"
    ],
    "category": "activities"
  },
  {
    "glyph": "🏏",
    "name": "cricket game",
    "keywords": [
      "cricket_game"
    ],
    "category": "activities"
  },
  {
    "glyph": "🏑",
    "name": "field hockey",
    "keywords": [
      "field_hockey"
    ],
    "category": "activities"
  },
  {
    "glyph": "🏒",
    "name": "ice hockey",
    "keywords": [
      "ice_hockey"
    ],
    "category": "activities"
  },
  {
    "glyph": "🥍",
    "name": "lacrosse",
    "keywords": [
      "lacrosse"
    ],
    "category": "activities"
  },
  {
    "glyph": "🏓",
    "name": "ping pong",
    "keywords": [
      "ping_pong"
    ],
    "category": "activities"
  },
  {
    "glyph": "🏸",
    "name": "badminton",
    "keywords": [
      "badminton"
    ],
    "category": "activities"
  },
  {
    "glyph": "🥊",
    "name": "boxing glove",
    "keywords": [
      "boxing_glove"
    ],
    "category": "activities"
  },
  {
    "glyph": "🥋",
    "name": "martial arts uniform",
    "keywords": [
      "martial_arts_uniform"
    ],
    "category": "activities"
  },
  {
    "glyph": "🥅",
    "name": "goal net",
    "keywords": [
      "goal_net"
    ],
    "category": "activities"
  },
  {
    "glyph": "⛳",
    "name": "flag in hole",
    "keywords": [
      "golf"
    ],
    "category": "activities"
  },
  {
    "glyph": "⛸️",
    "name": "ice skate",
    "keywords": [
      "ice_skate",
      "skating"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎣",
    "name": "fishing pole",
    "keywords": [
      "fishing_pole_and_fish"
    ],
    "category": "activities"
  },
  {
    "glyph": "🤿",
    "name": "diving mask",
    "keywords": [
      "diving_mask"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎽",
    "name": "running shirt",
    "keywords": [
      "running_shirt_with_sash",
      "marathon"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎿",
    "name": "skis",
    "keywords": [
      "ski"
    ],
    "category": "activities"
  },
  {
    "glyph": "🛷",
    "name": "sled",
    "keywords": [
      "sled"
    ],
    "category": "activities"
  },
  {
    "glyph": "🥌",
    "name": "curling stone",
    "keywords": [
      "curling_stone"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎯",
    "name": "bullseye",
    "keywords": [
      "dart",
      "target"
    ],
    "category": "activities"
  },
  {
    "glyph": "🪀",
    "name": "yo-yo",
    "keywords": [
      "yo_yo"
    ],
    "category": "activities"
  },
  {
    "glyph": "🪁",
    "name": "kite",
    "keywords": [
      "kite"
    ],
    "category": "activities"
  },
  {
    "glyph": "🔫",
    "name": "water pistol",
    "keywords": [
      "gun",
      "shoot",
      "weapon"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎱",
    "name": "pool 8 ball",
    "keywords": [
      "8ball",
      "pool",
      "billiards"
    ],
    "category": "activities"
  },
  {
    "glyph": "🔮",
    "name": "crystal ball",
    "keywords": [
      "crystal_ball",
      "fortune"
    ],
    "category": "activities"
  },
  {
    "glyph": "🪄",
    "name": "magic wand",
    "keywords": [
      "magic_wand"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎮",
    "name": "video game",
    "keywords": [
      "video_game",
      "play",
      "controller",
      "console"
    ],
    "category": "activities"
  },
  {
    "glyph": "🕹️",
    "name": "joystick",
    "keywords": [
      "joystick"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎰",
    "name": "slot machine",
    "keywords": [
      "slot_machine"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎲",
    "name": "game die",
    "keywords": [
      "game_die",
      "dice",
      "gambling"
    ],
    "category": "activities"
  },
  {
    "glyph": "🧩",
    "name": "puzzle piece",
    "keywords": [
      "jigsaw"
    ],
    "category": "activities"
  },
  {
    "glyph": "🧸",
    "name": "teddy bear",
    "keywords": [
      "teddy_bear"
    ],
    "category": "activities"
  },
  {
    "glyph": "🪅",
    "name": "piñata",
    "keywords": [
      "pinata"
    ],
    "category": "activities"
  },
  {
    "glyph": "🪩",
    "name": "mirror ball",
    "keywords": [
      "mirror_ball",
      "disco",
      "party"
    ],
    "category": "activities"
  },
  {
    "glyph": "🪆",
    "name": "nesting dolls",
    "keywords": [
      "nesting_dolls"
    ],
    "category": "activities"
  },
  {
    "glyph": "♠️",
    "name": "spade suit",
    "keywords": [
      "spades"
    ],
    "category": "activities"
  },
  {
    "glyph": "♥️",
    "name": "heart suit",
    "keywords": [
      "hearts"
    ],
    "category": "activities"
  },
  {
    "glyph": "♦️",
    "name": "diamond suit",
    "keywords": [
      "diamonds"
    ],
    "category": "activities"
  },
  {
    "glyph": "♣️",
    "name": "club suit",
    "keywords": [
      "clubs"
    ],
    "category": "activities"
  },
  {
    "glyph": "♟️",
    "name": "chess pawn",
    "keywords": [
      "chess_pawn"
    ],
    "category": "activities"
  },
  {
    "glyph": "🃏",
    "name": "joker",
    "keywords": [
      "black_joker"
    ],
    "category": "activities"
  },
  {
    "glyph": "🀄",
    "name": "mahjong red dragon",
    "keywords": [
      "mahjong"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎴",
    "name": "flower playing cards",
    "keywords": [
      "flower_playing_cards"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎭",
    "name": "performing arts",
    "keywords": [
      "performing_arts",
      "theater",
      "drama"
    ],
    "category": "activities"
  },
  {
    "glyph": "🖼️",
    "name": "framed picture",
    "keywords": [
      "framed_picture"
    ],
    "category": "activities"
  },
  {
    "glyph": "🎨",
    "name": "artist palette",
    "keywords": [
      "art",
      "design",
      "paint"
    ],
    "category": "activities"
  },
  {
    "glyph": "🧵",
    "name": "thread",
    "keywords": [
      "thread"
    ],
    "category": "activities"
  },
  {
    "glyph": "🪡",
    "name": "sewing needle",
    "keywords": [
      "sewing_needle"
    ],
    "category": "activities"
  },
  {
    "glyph": "🧶",
    "name": "yarn",
    "keywords": [
      "yarn"
    ],
    "category": "activities"
  },
  {
    "glyph": "🪢",
    "name": "knot",
    "keywords": [
      "knot"
    ],
    "category": "activities"
  },
  {
    "glyph": "👓",
    "name": "glasses",
    "keywords": [
      "eyeglasses",
      "glasses"
    ],
    "category": "objects"
  },
  {
    "glyph": "🕶️",
    "name": "sunglasses",
    "keywords": [
      "dark_sunglasses"
    ],
    "category": "objects"
  },
  {
    "glyph": "🥽",
    "name": "goggles",
    "keywords": [
      "goggles"
    ],
    "category": "objects"
  },
  {
    "glyph": "🥼",
    "name": "lab coat",
    "keywords": [
      "lab_coat"
    ],
    "category": "objects"
  },
  {
    "glyph": "🦺",
    "name": "safety vest",
    "keywords": [
      "safety_vest"
    ],
    "category": "objects"
  },
  {
    "glyph": "👔",
    "name": "necktie",
    "keywords": [
      "necktie",
      "shirt",
      "formal"
    ],
    "category": "objects"
  },
  {
    "glyph": "👕",
    "name": "t-shirt",
    "keywords": [
      "shirt",
      "tshirt"
    ],
    "category": "objects"
  },
  {
    "glyph": "👖",
    "name": "jeans",
    "keywords": [
      "jeans",
      "pants"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧣",
    "name": "scarf",
    "keywords": [
      "scarf"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧤",
    "name": "gloves",
    "keywords": [
      "gloves"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧥",
    "name": "coat",
    "keywords": [
      "coat"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧦",
    "name": "socks",
    "keywords": [
      "socks"
    ],
    "category": "objects"
  },
  {
    "glyph": "👗",
    "name": "dress",
    "keywords": [
      "dress"
    ],
    "category": "objects"
  },
  {
    "glyph": "👘",
    "name": "kimono",
    "keywords": [
      "kimono"
    ],
    "category": "objects"
  },
  {
    "glyph": "🥻",
    "name": "sari",
    "keywords": [
      "sari"
    ],
    "category": "objects"
  },
  {
    "glyph": "🩱",
    "name": "one-piece swimsuit",
    "keywords": [
      "one_piece_swimsuit"
    ],
    "category": "objects"
  },
  {
    "glyph": "🩲",
    "name": "briefs",
    "keywords": [
      "swim_brief"
    ],
    "category": "objects"
  },
  {
    "glyph": "🩳",
    "name": "shorts",
    "keywords": [
      "shorts"
    ],
    "category": "objects"
  },
  {
    "glyph": "👙",
    "name": "bikini",
    "keywords": [
      "bikini",
      "beach"
    ],
    "category": "objects"
  },
  {
    "glyph": "👚",
    "name": "woman’s clothes",
    "keywords": [
      "womans_clothes"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪭",
    "name": "folding hand fan",
    "keywords": [
      "folding_hand_fan",
      "sensu"
    ],
    "category": "objects"
  },
  {
    "glyph": "👛",
    "name": "purse",
    "keywords": [
      "purse"
    ],
    "category": "objects"
  },
  {
    "glyph": "👜",
    "name": "handbag",
    "keywords": [
      "handbag",
      "bag"
    ],
    "category": "objects"
  },
  {
    "glyph": "👝",
    "name": "clutch bag",
    "keywords": [
      "pouch",
      "bag"
    ],
    "category": "objects"
  },
  {
    "glyph": "🛍️",
    "name": "shopping bags",
    "keywords": [
      "shopping",
      "bags"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎒",
    "name": "backpack",
    "keywords": [
      "school_satchel"
    ],
    "category": "objects"
  },
  {
    "glyph": "🩴",
    "name": "thong sandal",
    "keywords": [
      "thong_sandal"
    ],
    "category": "objects"
  },
  {
    "glyph": "👞",
    "name": "man’s shoe",
    "keywords": [
      "mans_shoe",
      "shoe"
    ],
    "category": "objects"
  },
  {
    "glyph": "👟",
    "name": "running shoe",
    "keywords": [
      "athletic_shoe",
      "sneaker",
      "sport",
      "running"
    ],
    "category": "objects"
  },
  {
    "glyph": "🥾",
    "name": "hiking boot",
    "keywords": [
      "hiking_boot"
    ],
    "category": "objects"
  },
  {
    "glyph": "🥿",
    "name": "flat shoe",
    "keywords": [
      "flat_shoe"
    ],
    "category": "objects"
  },
  {
    "glyph": "👠",
    "name": "high-heeled shoe",
    "keywords": [
      "high_heel",
      "shoe"
    ],
    "category": "objects"
  },
  {
    "glyph": "👡",
    "name": "woman’s sandal",
    "keywords": [
      "sandal",
      "shoe"
    ],
    "category": "objects"
  },
  {
    "glyph": "🩰",
    "name": "ballet shoes",
    "keywords": [
      "ballet_shoes"
    ],
    "category": "objects"
  },
  {
    "glyph": "👢",
    "name": "woman’s boot",
    "keywords": [
      "boot"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪮",
    "name": "hair pick",
    "keywords": [
      "hair_pick"
    ],
    "category": "objects"
  },
  {
    "glyph": "👑",
    "name": "crown",
    "keywords": [
      "crown",
      "king",
      "queen",
      "royal"
    ],
    "category": "objects"
  },
  {
    "glyph": "👒",
    "name": "woman’s hat",
    "keywords": [
      "womans_hat"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎩",
    "name": "top hat",
    "keywords": [
      "tophat",
      "hat",
      "classy"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎓",
    "name": "graduation cap",
    "keywords": [
      "mortar_board",
      "education",
      "college",
      "university",
      "graduation"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧢",
    "name": "billed cap",
    "keywords": [
      "billed_cap"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪖",
    "name": "military helmet",
    "keywords": [
      "military_helmet"
    ],
    "category": "objects"
  },
  {
    "glyph": "⛑️",
    "name": "rescue worker’s helmet",
    "keywords": [
      "rescue_worker_helmet"
    ],
    "category": "objects"
  },
  {
    "glyph": "📿",
    "name": "prayer beads",
    "keywords": [
      "prayer_beads"
    ],
    "category": "objects"
  },
  {
    "glyph": "💄",
    "name": "lipstick",
    "keywords": [
      "lipstick",
      "makeup"
    ],
    "category": "objects"
  },
  {
    "glyph": "💍",
    "name": "ring",
    "keywords": [
      "ring",
      "wedding",
      "marriage",
      "engaged"
    ],
    "category": "objects"
  },
  {
    "glyph": "💎",
    "name": "gem stone",
    "keywords": [
      "gem",
      "diamond"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔇",
    "name": "muted speaker",
    "keywords": [
      "mute",
      "sound",
      "volume"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔈",
    "name": "speaker low volume",
    "keywords": [
      "speaker"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔉",
    "name": "speaker medium volume",
    "keywords": [
      "sound",
      "volume"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔊",
    "name": "speaker high volume",
    "keywords": [
      "loud_sound",
      "volume"
    ],
    "category": "objects"
  },
  {
    "glyph": "📢",
    "name": "loudspeaker",
    "keywords": [
      "loudspeaker",
      "announcement"
    ],
    "category": "objects"
  },
  {
    "glyph": "📣",
    "name": "megaphone",
    "keywords": [
      "mega"
    ],
    "category": "objects"
  },
  {
    "glyph": "📯",
    "name": "postal horn",
    "keywords": [
      "postal_horn"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔔",
    "name": "bell",
    "keywords": [
      "bell",
      "sound",
      "notification"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔕",
    "name": "bell with slash",
    "keywords": [
      "no_bell",
      "volume",
      "off"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎼",
    "name": "musical score",
    "keywords": [
      "musical_score"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎵",
    "name": "musical note",
    "keywords": [
      "musical_note"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎶",
    "name": "musical notes",
    "keywords": [
      "notes",
      "music"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎙️",
    "name": "studio microphone",
    "keywords": [
      "studio_microphone",
      "podcast"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎚️",
    "name": "level slider",
    "keywords": [
      "level_slider"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎛️",
    "name": "control knobs",
    "keywords": [
      "control_knobs"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎤",
    "name": "microphone",
    "keywords": [
      "microphone",
      "sing"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎧",
    "name": "headphone",
    "keywords": [
      "headphones",
      "music",
      "earphones"
    ],
    "category": "objects"
  },
  {
    "glyph": "📻",
    "name": "radio",
    "keywords": [
      "radio",
      "podcast"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎷",
    "name": "saxophone",
    "keywords": [
      "saxophone"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪗",
    "name": "accordion",
    "keywords": [
      "accordion"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎸",
    "name": "guitar",
    "keywords": [
      "guitar",
      "rock"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎹",
    "name": "musical keyboard",
    "keywords": [
      "musical_keyboard",
      "piano"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎺",
    "name": "trumpet",
    "keywords": [
      "trumpet"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎻",
    "name": "violin",
    "keywords": [
      "violin"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪕",
    "name": "banjo",
    "keywords": [
      "banjo"
    ],
    "category": "objects"
  },
  {
    "glyph": "🥁",
    "name": "drum",
    "keywords": [
      "drum"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪘",
    "name": "long drum",
    "keywords": [
      "long_drum"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪇",
    "name": "maracas",
    "keywords": [
      "maracas",
      "shaker"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪈",
    "name": "flute",
    "keywords": [
      "flute",
      "recorder"
    ],
    "category": "objects"
  },
  {
    "glyph": "📱",
    "name": "mobile phone",
    "keywords": [
      "iphone",
      "smartphone",
      "mobile"
    ],
    "category": "objects"
  },
  {
    "glyph": "📲",
    "name": "mobile phone with arrow",
    "keywords": [
      "calling",
      "call",
      "incoming"
    ],
    "category": "objects"
  },
  {
    "glyph": "☎️",
    "name": "telephone",
    "keywords": [
      "phone",
      "telephone"
    ],
    "category": "objects"
  },
  {
    "glyph": "📞",
    "name": "telephone receiver",
    "keywords": [
      "telephone_receiver",
      "phone",
      "call"
    ],
    "category": "objects"
  },
  {
    "glyph": "📟",
    "name": "pager",
    "keywords": [
      "pager"
    ],
    "category": "objects"
  },
  {
    "glyph": "📠",
    "name": "fax machine",
    "keywords": [
      "fax"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔋",
    "name": "battery",
    "keywords": [
      "battery",
      "power"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪫",
    "name": "low battery",
    "keywords": [
      "low_battery"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔌",
    "name": "electric plug",
    "keywords": [
      "electric_plug"
    ],
    "category": "objects"
  },
  {
    "glyph": "💻",
    "name": "laptop",
    "keywords": [
      "computer",
      "desktop",
      "screen"
    ],
    "category": "objects"
  },
  {
    "glyph": "🖥️",
    "name": "desktop computer",
    "keywords": [
      "desktop_computer"
    ],
    "category": "objects"
  },
  {
    "glyph": "🖨️",
    "name": "printer",
    "keywords": [
      "printer"
    ],
    "category": "objects"
  },
  {
    "glyph": "⌨️",
    "name": "keyboard",
    "keywords": [
      "keyboard"
    ],
    "category": "objects"
  },
  {
    "glyph": "🖱️",
    "name": "computer mouse",
    "keywords": [
      "computer_mouse"
    ],
    "category": "objects"
  },
  {
    "glyph": "🖲️",
    "name": "trackball",
    "keywords": [
      "trackball"
    ],
    "category": "objects"
  },
  {
    "glyph": "💽",
    "name": "computer disk",
    "keywords": [
      "minidisc"
    ],
    "category": "objects"
  },
  {
    "glyph": "💾",
    "name": "floppy disk",
    "keywords": [
      "floppy_disk",
      "save"
    ],
    "category": "objects"
  },
  {
    "glyph": "💿",
    "name": "optical disk",
    "keywords": [
      "cd"
    ],
    "category": "objects"
  },
  {
    "glyph": "📀",
    "name": "dvd",
    "keywords": [
      "dvd"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧮",
    "name": "abacus",
    "keywords": [
      "abacus"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎥",
    "name": "movie camera",
    "keywords": [
      "movie_camera",
      "film",
      "video"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎞️",
    "name": "film frames",
    "keywords": [
      "film_strip"
    ],
    "category": "objects"
  },
  {
    "glyph": "📽️",
    "name": "film projector",
    "keywords": [
      "film_projector"
    ],
    "category": "objects"
  },
  {
    "glyph": "🎬",
    "name": "clapper board",
    "keywords": [
      "clapper",
      "film"
    ],
    "category": "objects"
  },
  {
    "glyph": "📺",
    "name": "television",
    "keywords": [
      "tv"
    ],
    "category": "objects"
  },
  {
    "glyph": "📷",
    "name": "camera",
    "keywords": [
      "camera",
      "photo"
    ],
    "category": "objects"
  },
  {
    "glyph": "📸",
    "name": "camera with flash",
    "keywords": [
      "camera_flash",
      "photo"
    ],
    "category": "objects"
  },
  {
    "glyph": "📹",
    "name": "video camera",
    "keywords": [
      "video_camera"
    ],
    "category": "objects"
  },
  {
    "glyph": "📼",
    "name": "videocassette",
    "keywords": [
      "vhs"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔍",
    "name": "magnifying glass tilted left",
    "keywords": [
      "mag",
      "search",
      "zoom"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔎",
    "name": "magnifying glass tilted right",
    "keywords": [
      "mag_right"
    ],
    "category": "objects"
  },
  {
    "glyph": "🕯️",
    "name": "candle",
    "keywords": [
      "candle"
    ],
    "category": "objects"
  },
  {
    "glyph": "💡",
    "name": "light bulb",
    "keywords": [
      "bulb",
      "idea",
      "light"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔦",
    "name": "flashlight",
    "keywords": [
      "flashlight"
    ],
    "category": "objects"
  },
  {
    "glyph": "🏮",
    "name": "red paper lantern",
    "keywords": [
      "izakaya_lantern",
      "lantern"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪔",
    "name": "diya lamp",
    "keywords": [
      "diya_lamp"
    ],
    "category": "objects"
  },
  {
    "glyph": "📔",
    "name": "notebook with decorative cover",
    "keywords": [
      "notebook_with_decorative_cover"
    ],
    "category": "objects"
  },
  {
    "glyph": "📕",
    "name": "closed book",
    "keywords": [
      "closed_book"
    ],
    "category": "objects"
  },
  {
    "glyph": "📖",
    "name": "open book",
    "keywords": [
      "book",
      "open_book"
    ],
    "category": "objects"
  },
  {
    "glyph": "📗",
    "name": "green book",
    "keywords": [
      "green_book"
    ],
    "category": "objects"
  },
  {
    "glyph": "📘",
    "name": "blue book",
    "keywords": [
      "blue_book"
    ],
    "category": "objects"
  },
  {
    "glyph": "📙",
    "name": "orange book",
    "keywords": [
      "orange_book"
    ],
    "category": "objects"
  },
  {
    "glyph": "📚",
    "name": "books",
    "keywords": [
      "books",
      "library"
    ],
    "category": "objects"
  },
  {
    "glyph": "📓",
    "name": "notebook",
    "keywords": [
      "notebook"
    ],
    "category": "objects"
  },
  {
    "glyph": "📒",
    "name": "ledger",
    "keywords": [
      "ledger"
    ],
    "category": "objects"
  },
  {
    "glyph": "📃",
    "name": "page with curl",
    "keywords": [
      "page_with_curl"
    ],
    "category": "objects"
  },
  {
    "glyph": "📜",
    "name": "scroll",
    "keywords": [
      "scroll",
      "document"
    ],
    "category": "objects"
  },
  {
    "glyph": "📄",
    "name": "page facing up",
    "keywords": [
      "page_facing_up",
      "document"
    ],
    "category": "objects"
  },
  {
    "glyph": "📰",
    "name": "newspaper",
    "keywords": [
      "newspaper",
      "press"
    ],
    "category": "objects"
  },
  {
    "glyph": "🗞️",
    "name": "rolled-up newspaper",
    "keywords": [
      "newspaper_roll",
      "press"
    ],
    "category": "objects"
  },
  {
    "glyph": "📑",
    "name": "bookmark tabs",
    "keywords": [
      "bookmark_tabs"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔖",
    "name": "bookmark",
    "keywords": [
      "bookmark"
    ],
    "category": "objects"
  },
  {
    "glyph": "🏷️",
    "name": "label",
    "keywords": [
      "label",
      "tag"
    ],
    "category": "objects"
  },
  {
    "glyph": "💰",
    "name": "money bag",
    "keywords": [
      "moneybag",
      "dollar",
      "cream"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪙",
    "name": "coin",
    "keywords": [
      "coin"
    ],
    "category": "objects"
  },
  {
    "glyph": "💴",
    "name": "yen banknote",
    "keywords": [
      "yen"
    ],
    "category": "objects"
  },
  {
    "glyph": "💵",
    "name": "dollar banknote",
    "keywords": [
      "dollar",
      "money"
    ],
    "category": "objects"
  },
  {
    "glyph": "💶",
    "name": "euro banknote",
    "keywords": [
      "euro"
    ],
    "category": "objects"
  },
  {
    "glyph": "💷",
    "name": "pound banknote",
    "keywords": [
      "pound"
    ],
    "category": "objects"
  },
  {
    "glyph": "💸",
    "name": "money with wings",
    "keywords": [
      "money_with_wings",
      "dollar"
    ],
    "category": "objects"
  },
  {
    "glyph": "💳",
    "name": "credit card",
    "keywords": [
      "credit_card",
      "subscription"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧾",
    "name": "receipt",
    "keywords": [
      "receipt"
    ],
    "category": "objects"
  },
  {
    "glyph": "💹",
    "name": "chart increasing with yen",
    "keywords": [
      "chart"
    ],
    "category": "objects"
  },
  {
    "glyph": "✉️",
    "name": "envelope",
    "keywords": [
      "envelope",
      "letter",
      "email"
    ],
    "category": "objects"
  },
  {
    "glyph": "📧",
    "name": "e-mail",
    "keywords": [
      "email",
      "e-mail"
    ],
    "category": "objects"
  },
  {
    "glyph": "📨",
    "name": "incoming envelope",
    "keywords": [
      "incoming_envelope"
    ],
    "category": "objects"
  },
  {
    "glyph": "📩",
    "name": "envelope with arrow",
    "keywords": [
      "envelope_with_arrow"
    ],
    "category": "objects"
  },
  {
    "glyph": "📤",
    "name": "outbox tray",
    "keywords": [
      "outbox_tray"
    ],
    "category": "objects"
  },
  {
    "glyph": "📥",
    "name": "inbox tray",
    "keywords": [
      "inbox_tray"
    ],
    "category": "objects"
  },
  {
    "glyph": "📦",
    "name": "package",
    "keywords": [
      "package",
      "shipping"
    ],
    "category": "objects"
  },
  {
    "glyph": "📫",
    "name": "closed mailbox with raised flag",
    "keywords": [
      "mailbox"
    ],
    "category": "objects"
  },
  {
    "glyph": "📪",
    "name": "closed mailbox with lowered flag",
    "keywords": [
      "mailbox_closed"
    ],
    "category": "objects"
  },
  {
    "glyph": "📬",
    "name": "open mailbox with raised flag",
    "keywords": [
      "mailbox_with_mail"
    ],
    "category": "objects"
  },
  {
    "glyph": "📭",
    "name": "open mailbox with lowered flag",
    "keywords": [
      "mailbox_with_no_mail"
    ],
    "category": "objects"
  },
  {
    "glyph": "📮",
    "name": "postbox",
    "keywords": [
      "postbox"
    ],
    "category": "objects"
  },
  {
    "glyph": "🗳️",
    "name": "ballot box with ballot",
    "keywords": [
      "ballot_box"
    ],
    "category": "objects"
  },
  {
    "glyph": "✏️",
    "name": "pencil",
    "keywords": [
      "pencil2"
    ],
    "category": "objects"
  },
  {
    "glyph": "✒️",
    "name": "black nib",
    "keywords": [
      "black_nib"
    ],
    "category": "objects"
  },
  {
    "glyph": "🖋️",
    "name": "fountain pen",
    "keywords": [
      "fountain_pen"
    ],
    "category": "objects"
  },
  {
    "glyph": "🖊️",
    "name": "pen",
    "keywords": [
      "pen"
    ],
    "category": "objects"
  },
  {
    "glyph": "🖌️",
    "name": "paintbrush",
    "keywords": [
      "paintbrush"
    ],
    "category": "objects"
  },
  {
    "glyph": "🖍️",
    "name": "crayon",
    "keywords": [
      "crayon"
    ],
    "category": "objects"
  },
  {
    "glyph": "📝",
    "name": "memo",
    "keywords": [
      "memo",
      "pencil",
      "document",
      "note"
    ],
    "category": "objects"
  },
  {
    "glyph": "💼",
    "name": "briefcase",
    "keywords": [
      "briefcase",
      "business"
    ],
    "category": "objects"
  },
  {
    "glyph": "📁",
    "name": "file folder",
    "keywords": [
      "file_folder",
      "directory"
    ],
    "category": "objects"
  },
  {
    "glyph": "📂",
    "name": "open file folder",
    "keywords": [
      "open_file_folder"
    ],
    "category": "objects"
  },
  {
    "glyph": "🗂️",
    "name": "card index dividers",
    "keywords": [
      "card_index_dividers"
    ],
    "category": "objects"
  },
  {
    "glyph": "📅",
    "name": "calendar",
    "keywords": [
      "date",
      "calendar",
      "schedule"
    ],
    "category": "objects"
  },
  {
    "glyph": "📆",
    "name": "tear-off calendar",
    "keywords": [
      "calendar",
      "schedule"
    ],
    "category": "objects"
  },
  {
    "glyph": "🗒️",
    "name": "spiral notepad",
    "keywords": [
      "spiral_notepad"
    ],
    "category": "objects"
  },
  {
    "glyph": "🗓️",
    "name": "spiral calendar",
    "keywords": [
      "spiral_calendar"
    ],
    "category": "objects"
  },
  {
    "glyph": "📇",
    "name": "card index",
    "keywords": [
      "card_index"
    ],
    "category": "objects"
  },
  {
    "glyph": "📈",
    "name": "chart increasing",
    "keywords": [
      "chart_with_upwards_trend",
      "graph",
      "metrics"
    ],
    "category": "objects"
  },
  {
    "glyph": "📉",
    "name": "chart decreasing",
    "keywords": [
      "chart_with_downwards_trend",
      "graph",
      "metrics"
    ],
    "category": "objects"
  },
  {
    "glyph": "📊",
    "name": "bar chart",
    "keywords": [
      "bar_chart",
      "stats",
      "metrics"
    ],
    "category": "objects"
  },
  {
    "glyph": "📋",
    "name": "clipboard",
    "keywords": [
      "clipboard"
    ],
    "category": "objects"
  },
  {
    "glyph": "📌",
    "name": "pushpin",
    "keywords": [
      "pushpin",
      "location"
    ],
    "category": "objects"
  },
  {
    "glyph": "📍",
    "name": "round pushpin",
    "keywords": [
      "round_pushpin",
      "location"
    ],
    "category": "objects"
  },
  {
    "glyph": "📎",
    "name": "paperclip",
    "keywords": [
      "paperclip"
    ],
    "category": "objects"
  },
  {
    "glyph": "🖇️",
    "name": "linked paperclips",
    "keywords": [
      "paperclips"
    ],
    "category": "objects"
  },
  {
    "glyph": "📏",
    "name": "straight ruler",
    "keywords": [
      "straight_ruler"
    ],
    "category": "objects"
  },
  {
    "glyph": "📐",
    "name": "triangular ruler",
    "keywords": [
      "triangular_ruler"
    ],
    "category": "objects"
  },
  {
    "glyph": "✂️",
    "name": "scissors",
    "keywords": [
      "scissors",
      "cut"
    ],
    "category": "objects"
  },
  {
    "glyph": "🗃️",
    "name": "card file box",
    "keywords": [
      "card_file_box"
    ],
    "category": "objects"
  },
  {
    "glyph": "🗄️",
    "name": "file cabinet",
    "keywords": [
      "file_cabinet"
    ],
    "category": "objects"
  },
  {
    "glyph": "🗑️",
    "name": "wastebasket",
    "keywords": [
      "wastebasket",
      "trash"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔒",
    "name": "locked",
    "keywords": [
      "lock",
      "security",
      "private"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔓",
    "name": "unlocked",
    "keywords": [
      "unlock",
      "security"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔏",
    "name": "locked with pen",
    "keywords": [
      "lock_with_ink_pen"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔐",
    "name": "locked with key",
    "keywords": [
      "closed_lock_with_key",
      "security"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔑",
    "name": "key",
    "keywords": [
      "key",
      "lock",
      "password"
    ],
    "category": "objects"
  },
  {
    "glyph": "🗝️",
    "name": "old key",
    "keywords": [
      "old_key"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔨",
    "name": "hammer",
    "keywords": [
      "hammer",
      "tool"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪓",
    "name": "axe",
    "keywords": [
      "axe"
    ],
    "category": "objects"
  },
  {
    "glyph": "⛏️",
    "name": "pick",
    "keywords": [
      "pick"
    ],
    "category": "objects"
  },
  {
    "glyph": "⚒️",
    "name": "hammer and pick",
    "keywords": [
      "hammer_and_pick"
    ],
    "category": "objects"
  },
  {
    "glyph": "🛠️",
    "name": "hammer and wrench",
    "keywords": [
      "hammer_and_wrench"
    ],
    "category": "objects"
  },
  {
    "glyph": "🗡️",
    "name": "dagger",
    "keywords": [
      "dagger"
    ],
    "category": "objects"
  },
  {
    "glyph": "⚔️",
    "name": "crossed swords",
    "keywords": [
      "crossed_swords"
    ],
    "category": "objects"
  },
  {
    "glyph": "💣",
    "name": "bomb",
    "keywords": [
      "bomb",
      "boom"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪃",
    "name": "boomerang",
    "keywords": [
      "boomerang"
    ],
    "category": "objects"
  },
  {
    "glyph": "🏹",
    "name": "bow and arrow",
    "keywords": [
      "bow_and_arrow",
      "archery"
    ],
    "category": "objects"
  },
  {
    "glyph": "🛡️",
    "name": "shield",
    "keywords": [
      "shield"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪚",
    "name": "carpentry saw",
    "keywords": [
      "carpentry_saw"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔧",
    "name": "wrench",
    "keywords": [
      "wrench",
      "tool"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪛",
    "name": "screwdriver",
    "keywords": [
      "screwdriver"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔩",
    "name": "nut and bolt",
    "keywords": [
      "nut_and_bolt"
    ],
    "category": "objects"
  },
  {
    "glyph": "⚙️",
    "name": "gear",
    "keywords": [
      "gear"
    ],
    "category": "objects"
  },
  {
    "glyph": "🗜️",
    "name": "clamp",
    "keywords": [
      "clamp"
    ],
    "category": "objects"
  },
  {
    "glyph": "⚖️",
    "name": "balance scale",
    "keywords": [
      "balance_scale"
    ],
    "category": "objects"
  },
  {
    "glyph": "🦯",
    "name": "white cane",
    "keywords": [
      "probing_cane"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔗",
    "name": "link",
    "keywords": [
      "link"
    ],
    "category": "objects"
  },
  {
    "glyph": "⛓️",
    "name": "chains",
    "keywords": [
      "chains"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪝",
    "name": "hook",
    "keywords": [
      "hook"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧰",
    "name": "toolbox",
    "keywords": [
      "toolbox"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧲",
    "name": "magnet",
    "keywords": [
      "magnet"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪜",
    "name": "ladder",
    "keywords": [
      "ladder"
    ],
    "category": "objects"
  },
  {
    "glyph": "⚗️",
    "name": "alembic",
    "keywords": [
      "alembic"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧪",
    "name": "test tube",
    "keywords": [
      "test_tube"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧫",
    "name": "petri dish",
    "keywords": [
      "petri_dish"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧬",
    "name": "dna",
    "keywords": [
      "dna"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔬",
    "name": "microscope",
    "keywords": [
      "microscope",
      "science",
      "laboratory",
      "investigate"
    ],
    "category": "objects"
  },
  {
    "glyph": "🔭",
    "name": "telescope",
    "keywords": [
      "telescope"
    ],
    "category": "objects"
  },
  {
    "glyph": "📡",
    "name": "satellite antenna",
    "keywords": [
      "satellite",
      "signal"
    ],
    "category": "objects"
  },
  {
    "glyph": "💉",
    "name": "syringe",
    "keywords": [
      "syringe",
      "health",
      "hospital",
      "needle"
    ],
    "category": "objects"
  },
  {
    "glyph": "🩸",
    "name": "drop of blood",
    "keywords": [
      "drop_of_blood"
    ],
    "category": "objects"
  },
  {
    "glyph": "💊",
    "name": "pill",
    "keywords": [
      "pill",
      "health",
      "medicine"
    ],
    "category": "objects"
  },
  {
    "glyph": "🩹",
    "name": "adhesive bandage",
    "keywords": [
      "adhesive_bandage"
    ],
    "category": "objects"
  },
  {
    "glyph": "🩼",
    "name": "crutch",
    "keywords": [
      "crutch"
    ],
    "category": "objects"
  },
  {
    "glyph": "🩺",
    "name": "stethoscope",
    "keywords": [
      "stethoscope"
    ],
    "category": "objects"
  },
  {
    "glyph": "🩻",
    "name": "x-ray",
    "keywords": [
      "x_ray"
    ],
    "category": "objects"
  },
  {
    "glyph": "🚪",
    "name": "door",
    "keywords": [
      "door"
    ],
    "category": "objects"
  },
  {
    "glyph": "🛗",
    "name": "elevator",
    "keywords": [
      "elevator"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪞",
    "name": "mirror",
    "keywords": [
      "mirror"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪟",
    "name": "window",
    "keywords": [
      "window"
    ],
    "category": "objects"
  },
  {
    "glyph": "🛏️",
    "name": "bed",
    "keywords": [
      "bed"
    ],
    "category": "objects"
  },
  {
    "glyph": "🛋️",
    "name": "couch and lamp",
    "keywords": [
      "couch_and_lamp"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪑",
    "name": "chair",
    "keywords": [
      "chair"
    ],
    "category": "objects"
  },
  {
    "glyph": "🚽",
    "name": "toilet",
    "keywords": [
      "toilet",
      "wc"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪠",
    "name": "plunger",
    "keywords": [
      "plunger"
    ],
    "category": "objects"
  },
  {
    "glyph": "🚿",
    "name": "shower",
    "keywords": [
      "shower",
      "bath"
    ],
    "category": "objects"
  },
  {
    "glyph": "🛁",
    "name": "bathtub",
    "keywords": [
      "bathtub"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪤",
    "name": "mouse trap",
    "keywords": [
      "mouse_trap"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪒",
    "name": "razor",
    "keywords": [
      "razor"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧴",
    "name": "lotion bottle",
    "keywords": [
      "lotion_bottle"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧷",
    "name": "safety pin",
    "keywords": [
      "safety_pin"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧹",
    "name": "broom",
    "keywords": [
      "broom"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧺",
    "name": "basket",
    "keywords": [
      "basket"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧻",
    "name": "roll of paper",
    "keywords": [
      "roll_of_paper",
      "toilet"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪣",
    "name": "bucket",
    "keywords": [
      "bucket"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧼",
    "name": "soap",
    "keywords": [
      "soap"
    ],
    "category": "objects"
  },
  {
    "glyph": "🫧",
    "name": "bubbles",
    "keywords": [
      "bubbles"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪥",
    "name": "toothbrush",
    "keywords": [
      "toothbrush"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧽",
    "name": "sponge",
    "keywords": [
      "sponge"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧯",
    "name": "fire extinguisher",
    "keywords": [
      "fire_extinguisher"
    ],
    "category": "objects"
  },
  {
    "glyph": "🛒",
    "name": "shopping cart",
    "keywords": [
      "shopping_cart"
    ],
    "category": "objects"
  },
  {
    "glyph": "🚬",
    "name": "cigarette",
    "keywords": [
      "smoking",
      "cigarette"
    ],
    "category": "objects"
  },
  {
    "glyph": "⚰️",
    "name": "coffin",
    "keywords": [
      "coffin",
      "funeral"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪦",
    "name": "headstone",
    "keywords": [
      "headstone"
    ],
    "category": "objects"
  },
  {
    "glyph": "⚱️",
    "name": "funeral urn",
    "keywords": [
      "funeral_urn"
    ],
    "category": "objects"
  },
  {
    "glyph": "🧿",
    "name": "nazar amulet",
    "keywords": [
      "nazar_amulet"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪬",
    "name": "hamsa",
    "keywords": [
      "hamsa"
    ],
    "category": "objects"
  },
  {
    "glyph": "🗿",
    "name": "moai",
    "keywords": [
      "moyai",
      "stone"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪧",
    "name": "placard",
    "keywords": [
      "placard"
    ],
    "category": "objects"
  },
  {
    "glyph": "🪪",
    "name": "identification card",
    "keywords": [
      "identification_card"
    ],
    "category": "objects"
  },
  {
    "glyph": "🏧",
    "name": "ATM sign",
    "keywords": [
      "atm"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🚮",
    "name": "litter in bin sign",
    "keywords": [
      "put_litter_in_its_place"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🚰",
    "name": "potable water",
    "keywords": [
      "potable_water"
    ],
    "category": "symbols"
  },
  {
    "glyph": "♿",
    "name": "wheelchair symbol",
    "keywords": [
      "wheelchair",
      "accessibility"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🚹",
    "name": "men’s room",
    "keywords": [
      "mens"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🚺",
    "name": "women’s room",
    "keywords": [
      "womens"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🚻",
    "name": "restroom",
    "keywords": [
      "restroom",
      "toilet"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🚼",
    "name": "baby symbol",
    "keywords": [
      "baby_symbol"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🚾",
    "name": "water closet",
    "keywords": [
      "wc",
      "toilet",
      "restroom"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🛂",
    "name": "passport control",
    "keywords": [
      "passport_control"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🛃",
    "name": "customs",
    "keywords": [
      "customs"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🛄",
    "name": "baggage claim",
    "keywords": [
      "baggage_claim",
      "airport"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🛅",
    "name": "left luggage",
    "keywords": [
      "left_luggage"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⚠️",
    "name": "warning",
    "keywords": [
      "warning",
      "wip"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🚸",
    "name": "children crossing",
    "keywords": [
      "children_crossing"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⛔",
    "name": "no entry",
    "keywords": [
      "no_entry",
      "limit"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🚫",
    "name": "prohibited",
    "keywords": [
      "no_entry_sign",
      "block",
      "forbidden"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🚳",
    "name": "no bicycles",
    "keywords": [
      "no_bicycles"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🚭",
    "name": "no smoking",
    "keywords": [
      "no_smoking"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🚯",
    "name": "no littering",
    "keywords": [
      "do_not_litter"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🚱",
    "name": "non-potable water",
    "keywords": [
      "non-potable_water"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🚷",
    "name": "no pedestrians",
    "keywords": [
      "no_pedestrians"
    ],
    "category": "symbols"
  },
  {
    "glyph": "📵",
    "name": "no mobile phones",
    "keywords": [
      "no_mobile_phones"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔞",
    "name": "no one under eighteen",
    "keywords": [
      "underage"
    ],
    "category": "symbols"
  },
  {
    "glyph": "☢️",
    "name": "radioactive",
    "keywords": [
      "radioactive"
    ],
    "category": "symbols"
  },
  {
    "glyph": "☣️",
    "name": "biohazard",
    "keywords": [
      "biohazard"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⬆️",
    "name": "up arrow",
    "keywords": [
      "arrow_up"
    ],
    "category": "symbols"
  },
  {
    "glyph": "↗️",
    "name": "up-right arrow",
    "keywords": [
      "arrow_upper_right"
    ],
    "category": "symbols"
  },
  {
    "glyph": "➡️",
    "name": "right arrow",
    "keywords": [
      "arrow_right"
    ],
    "category": "symbols"
  },
  {
    "glyph": "↘️",
    "name": "down-right arrow",
    "keywords": [
      "arrow_lower_right"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⬇️",
    "name": "down arrow",
    "keywords": [
      "arrow_down"
    ],
    "category": "symbols"
  },
  {
    "glyph": "↙️",
    "name": "down-left arrow",
    "keywords": [
      "arrow_lower_left"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⬅️",
    "name": "left arrow",
    "keywords": [
      "arrow_left"
    ],
    "category": "symbols"
  },
  {
    "glyph": "↖️",
    "name": "up-left arrow",
    "keywords": [
      "arrow_upper_left"
    ],
    "category": "symbols"
  },
  {
    "glyph": "↕️",
    "name": "up-down arrow",
    "keywords": [
      "arrow_up_down"
    ],
    "category": "symbols"
  },
  {
    "glyph": "↔️",
    "name": "left-right arrow",
    "keywords": [
      "left_right_arrow"
    ],
    "category": "symbols"
  },
  {
    "glyph": "↩️",
    "name": "right arrow curving left",
    "keywords": [
      "leftwards_arrow_with_hook",
      "return"
    ],
    "category": "symbols"
  },
  {
    "glyph": "↪️",
    "name": "left arrow curving right",
    "keywords": [
      "arrow_right_hook"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⤴️",
    "name": "right arrow curving up",
    "keywords": [
      "arrow_heading_up"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⤵️",
    "name": "right arrow curving down",
    "keywords": [
      "arrow_heading_down"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔃",
    "name": "clockwise vertical arrows",
    "keywords": [
      "arrows_clockwise"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔄",
    "name": "counterclockwise arrows button",
    "keywords": [
      "arrows_counterclockwise",
      "sync"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔙",
    "name": "BACK arrow",
    "keywords": [
      "back"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔚",
    "name": "END arrow",
    "keywords": [
      "end"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔛",
    "name": "ON! arrow",
    "keywords": [
      "on"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔜",
    "name": "SOON arrow",
    "keywords": [
      "soon"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔝",
    "name": "TOP arrow",
    "keywords": [
      "top"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🛐",
    "name": "place of worship",
    "keywords": [
      "place_of_worship"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⚛️",
    "name": "atom symbol",
    "keywords": [
      "atom_symbol"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🕉️",
    "name": "om",
    "keywords": [
      "om"
    ],
    "category": "symbols"
  },
  {
    "glyph": "✡️",
    "name": "star of David",
    "keywords": [
      "star_of_david"
    ],
    "category": "symbols"
  },
  {
    "glyph": "☸️",
    "name": "wheel of dharma",
    "keywords": [
      "wheel_of_dharma"
    ],
    "category": "symbols"
  },
  {
    "glyph": "☯️",
    "name": "yin yang",
    "keywords": [
      "yin_yang"
    ],
    "category": "symbols"
  },
  {
    "glyph": "✝️",
    "name": "latin cross",
    "keywords": [
      "latin_cross"
    ],
    "category": "symbols"
  },
  {
    "glyph": "☦️",
    "name": "orthodox cross",
    "keywords": [
      "orthodox_cross"
    ],
    "category": "symbols"
  },
  {
    "glyph": "☪️",
    "name": "star and crescent",
    "keywords": [
      "star_and_crescent"
    ],
    "category": "symbols"
  },
  {
    "glyph": "☮️",
    "name": "peace symbol",
    "keywords": [
      "peace_symbol"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🕎",
    "name": "menorah",
    "keywords": [
      "menorah"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔯",
    "name": "dotted six-pointed star",
    "keywords": [
      "six_pointed_star"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🪯",
    "name": "khanda",
    "keywords": [
      "khanda"
    ],
    "category": "symbols"
  },
  {
    "glyph": "♈",
    "name": "Aries",
    "keywords": [
      "aries"
    ],
    "category": "symbols"
  },
  {
    "glyph": "♉",
    "name": "Taurus",
    "keywords": [
      "taurus"
    ],
    "category": "symbols"
  },
  {
    "glyph": "♊",
    "name": "Gemini",
    "keywords": [
      "gemini"
    ],
    "category": "symbols"
  },
  {
    "glyph": "♋",
    "name": "Cancer",
    "keywords": [
      "cancer"
    ],
    "category": "symbols"
  },
  {
    "glyph": "♌",
    "name": "Leo",
    "keywords": [
      "leo"
    ],
    "category": "symbols"
  },
  {
    "glyph": "♍",
    "name": "Virgo",
    "keywords": [
      "virgo"
    ],
    "category": "symbols"
  },
  {
    "glyph": "♎",
    "name": "Libra",
    "keywords": [
      "libra"
    ],
    "category": "symbols"
  },
  {
    "glyph": "♏",
    "name": "Scorpio",
    "keywords": [
      "scorpius"
    ],
    "category": "symbols"
  },
  {
    "glyph": "♐",
    "name": "Sagittarius",
    "keywords": [
      "sagittarius"
    ],
    "category": "symbols"
  },
  {
    "glyph": "♑",
    "name": "Capricorn",
    "keywords": [
      "capricorn"
    ],
    "category": "symbols"
  },
  {
    "glyph": "♒",
    "name": "Aquarius",
    "keywords": [
      "aquarius"
    ],
    "category": "symbols"
  },
  {
    "glyph": "♓",
    "name": "Pisces",
    "keywords": [
      "pisces"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⛎",
    "name": "Ophiuchus",
    "keywords": [
      "ophiuchus"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔀",
    "name": "shuffle tracks button",
    "keywords": [
      "twisted_rightwards_arrows",
      "shuffle"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔁",
    "name": "repeat button",
    "keywords": [
      "repeat",
      "loop"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔂",
    "name": "repeat single button",
    "keywords": [
      "repeat_one"
    ],
    "category": "symbols"
  },
  {
    "glyph": "▶️",
    "name": "play button",
    "keywords": [
      "arrow_forward"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⏩",
    "name": "fast-forward button",
    "keywords": [
      "fast_forward"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⏭️",
    "name": "next track button",
    "keywords": [
      "next_track_button"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⏯️",
    "name": "play or pause button",
    "keywords": [
      "play_or_pause_button"
    ],
    "category": "symbols"
  },
  {
    "glyph": "◀️",
    "name": "reverse button",
    "keywords": [
      "arrow_backward"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⏪",
    "name": "fast reverse button",
    "keywords": [
      "rewind"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⏮️",
    "name": "last track button",
    "keywords": [
      "previous_track_button"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔼",
    "name": "upwards button",
    "keywords": [
      "arrow_up_small"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⏫",
    "name": "fast up button",
    "keywords": [
      "arrow_double_up"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔽",
    "name": "downwards button",
    "keywords": [
      "arrow_down_small"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⏬",
    "name": "fast down button",
    "keywords": [
      "arrow_double_down"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⏸️",
    "name": "pause button",
    "keywords": [
      "pause_button"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⏹️",
    "name": "stop button",
    "keywords": [
      "stop_button"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⏺️",
    "name": "record button",
    "keywords": [
      "record_button"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⏏️",
    "name": "eject button",
    "keywords": [
      "eject_button"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🎦",
    "name": "cinema",
    "keywords": [
      "cinema",
      "film",
      "movie"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔅",
    "name": "dim button",
    "keywords": [
      "low_brightness"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔆",
    "name": "bright button",
    "keywords": [
      "high_brightness"
    ],
    "category": "symbols"
  },
  {
    "glyph": "📶",
    "name": "antenna bars",
    "keywords": [
      "signal_strength",
      "wifi"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🛜",
    "name": "wireless",
    "keywords": [
      "wireless",
      "wifi"
    ],
    "category": "symbols"
  },
  {
    "glyph": "📳",
    "name": "vibration mode",
    "keywords": [
      "vibration_mode"
    ],
    "category": "symbols"
  },
  {
    "glyph": "📴",
    "name": "mobile phone off",
    "keywords": [
      "mobile_phone_off",
      "mute",
      "off"
    ],
    "category": "symbols"
  },
  {
    "glyph": "♀️",
    "name": "female sign",
    "keywords": [
      "female_sign"
    ],
    "category": "symbols"
  },
  {
    "glyph": "♂️",
    "name": "male sign",
    "keywords": [
      "male_sign"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⚧️",
    "name": "transgender symbol",
    "keywords": [
      "transgender_symbol"
    ],
    "category": "symbols"
  },
  {
    "glyph": "✖️",
    "name": "multiply",
    "keywords": [
      "heavy_multiplication_x"
    ],
    "category": "symbols"
  },
  {
    "glyph": "➕",
    "name": "plus",
    "keywords": [
      "heavy_plus_sign"
    ],
    "category": "symbols"
  },
  {
    "glyph": "➖",
    "name": "minus",
    "keywords": [
      "heavy_minus_sign"
    ],
    "category": "symbols"
  },
  {
    "glyph": "➗",
    "name": "divide",
    "keywords": [
      "heavy_division_sign"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🟰",
    "name": "heavy equals sign",
    "keywords": [
      "heavy_equals_sign"
    ],
    "category": "symbols"
  },
  {
    "glyph": "♾️",
    "name": "infinity",
    "keywords": [
      "infinity"
    ],
    "category": "symbols"
  },
  {
    "glyph": "‼️",
    "name": "double exclamation mark",
    "keywords": [
      "bangbang"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⁉️",
    "name": "exclamation question mark",
    "keywords": [
      "interrobang"
    ],
    "category": "symbols"
  },
  {
    "glyph": "❓",
    "name": "red question mark",
    "keywords": [
      "question",
      "confused"
    ],
    "category": "symbols"
  },
  {
    "glyph": "❔",
    "name": "white question mark",
    "keywords": [
      "grey_question"
    ],
    "category": "symbols"
  },
  {
    "glyph": "❕",
    "name": "white exclamation mark",
    "keywords": [
      "grey_exclamation"
    ],
    "category": "symbols"
  },
  {
    "glyph": "❗",
    "name": "red exclamation mark",
    "keywords": [
      "exclamation",
      "heavy_exclamation_mark",
      "bang"
    ],
    "category": "symbols"
  },
  {
    "glyph": "〰️",
    "name": "wavy dash",
    "keywords": [
      "wavy_dash"
    ],
    "category": "symbols"
  },
  {
    "glyph": "💱",
    "name": "currency exchange",
    "keywords": [
      "currency_exchange"
    ],
    "category": "symbols"
  },
  {
    "glyph": "💲",
    "name": "heavy dollar sign",
    "keywords": [
      "heavy_dollar_sign"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⚕️",
    "name": "medical symbol",
    "keywords": [
      "medical_symbol"
    ],
    "category": "symbols"
  },
  {
    "glyph": "♻️",
    "name": "recycling symbol",
    "keywords": [
      "recycle",
      "environment",
      "green"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⚜️",
    "name": "fleur-de-lis",
    "keywords": [
      "fleur_de_lis"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔱",
    "name": "trident emblem",
    "keywords": [
      "trident"
    ],
    "category": "symbols"
  },
  {
    "glyph": "📛",
    "name": "name badge",
    "keywords": [
      "name_badge"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔰",
    "name": "Japanese symbol for beginner",
    "keywords": [
      "beginner"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⭕",
    "name": "hollow red circle",
    "keywords": [
      "o"
    ],
    "category": "symbols"
  },
  {
    "glyph": "✅",
    "name": "check mark button",
    "keywords": [
      "white_check_mark"
    ],
    "category": "symbols"
  },
  {
    "glyph": "☑️",
    "name": "check box with check",
    "keywords": [
      "ballot_box_with_check"
    ],
    "category": "symbols"
  },
  {
    "glyph": "✔️",
    "name": "check mark",
    "keywords": [
      "heavy_check_mark"
    ],
    "category": "symbols"
  },
  {
    "glyph": "❌",
    "name": "cross mark",
    "keywords": [
      "x"
    ],
    "category": "symbols"
  },
  {
    "glyph": "❎",
    "name": "cross mark button",
    "keywords": [
      "negative_squared_cross_mark"
    ],
    "category": "symbols"
  },
  {
    "glyph": "➰",
    "name": "curly loop",
    "keywords": [
      "curly_loop"
    ],
    "category": "symbols"
  },
  {
    "glyph": "➿",
    "name": "double curly loop",
    "keywords": [
      "loop"
    ],
    "category": "symbols"
  },
  {
    "glyph": "〽️",
    "name": "part alternation mark",
    "keywords": [
      "part_alternation_mark"
    ],
    "category": "symbols"
  },
  {
    "glyph": "✳️",
    "name": "eight-spoked asterisk",
    "keywords": [
      "eight_spoked_asterisk"
    ],
    "category": "symbols"
  },
  {
    "glyph": "✴️",
    "name": "eight-pointed star",
    "keywords": [
      "eight_pointed_black_star"
    ],
    "category": "symbols"
  },
  {
    "glyph": "❇️",
    "name": "sparkle",
    "keywords": [
      "sparkle"
    ],
    "category": "symbols"
  },
  {
    "glyph": "©️",
    "name": "copyright",
    "keywords": [
      "copyright"
    ],
    "category": "symbols"
  },
  {
    "glyph": "®️",
    "name": "registered",
    "keywords": [
      "registered"
    ],
    "category": "symbols"
  },
  {
    "glyph": "™️",
    "name": "trade mark",
    "keywords": [
      "tm",
      "trademark"
    ],
    "category": "symbols"
  },
  {
    "glyph": "#️⃣",
    "name": "keycap: #",
    "keywords": [
      "hash",
      "number"
    ],
    "category": "symbols"
  },
  {
    "glyph": "*️⃣",
    "name": "keycap: *",
    "keywords": [
      "asterisk"
    ],
    "category": "symbols"
  },
  {
    "glyph": "0️⃣",
    "name": "keycap: 0",
    "keywords": [
      "zero"
    ],
    "category": "symbols"
  },
  {
    "glyph": "1️⃣",
    "name": "keycap: 1",
    "keywords": [
      "one"
    ],
    "category": "symbols"
  },
  {
    "glyph": "2️⃣",
    "name": "keycap: 2",
    "keywords": [
      "two"
    ],
    "category": "symbols"
  },
  {
    "glyph": "3️⃣",
    "name": "keycap: 3",
    "keywords": [
      "three"
    ],
    "category": "symbols"
  },
  {
    "glyph": "4️⃣",
    "name": "keycap: 4",
    "keywords": [
      "four"
    ],
    "category": "symbols"
  },
  {
    "glyph": "5️⃣",
    "name": "keycap: 5",
    "keywords": [
      "five"
    ],
    "category": "symbols"
  },
  {
    "glyph": "6️⃣",
    "name": "keycap: 6",
    "keywords": [
      "six"
    ],
    "category": "symbols"
  },
  {
    "glyph": "7️⃣",
    "name": "keycap: 7",
    "keywords": [
      "seven"
    ],
    "category": "symbols"
  },
  {
    "glyph": "8️⃣",
    "name": "keycap: 8",
    "keywords": [
      "eight"
    ],
    "category": "symbols"
  },
  {
    "glyph": "9️⃣",
    "name": "keycap: 9",
    "keywords": [
      "nine"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔟",
    "name": "keycap: 10",
    "keywords": [
      "keycap_ten"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔠",
    "name": "input latin uppercase",
    "keywords": [
      "capital_abcd",
      "letters"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔡",
    "name": "input latin lowercase",
    "keywords": [
      "abcd"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔢",
    "name": "input numbers",
    "keywords": [
      "1234",
      "numbers"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔣",
    "name": "input symbols",
    "keywords": [
      "symbols"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔤",
    "name": "input latin letters",
    "keywords": [
      "abc",
      "alphabet"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🅰️",
    "name": "A button (blood type)",
    "keywords": [
      "a"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🆎",
    "name": "AB button (blood type)",
    "keywords": [
      "ab"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🅱️",
    "name": "B button (blood type)",
    "keywords": [
      "b"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🆑",
    "name": "CL button",
    "keywords": [
      "cl"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🆒",
    "name": "COOL button",
    "keywords": [
      "cool"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🆓",
    "name": "FREE button",
    "keywords": [
      "free"
    ],
    "category": "symbols"
  },
  {
    "glyph": "ℹ️",
    "name": "information",
    "keywords": [
      "information_source"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🆔",
    "name": "ID button",
    "keywords": [
      "id"
    ],
    "category": "symbols"
  },
  {
    "glyph": "Ⓜ️",
    "name": "circled M",
    "keywords": [
      "m"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🆕",
    "name": "NEW button",
    "keywords": [
      "new",
      "fresh"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🆖",
    "name": "NG button",
    "keywords": [
      "ng"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🅾️",
    "name": "O button (blood type)",
    "keywords": [
      "o2"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🆗",
    "name": "OK button",
    "keywords": [
      "ok",
      "yes"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🅿️",
    "name": "P button",
    "keywords": [
      "parking"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🆘",
    "name": "SOS button",
    "keywords": [
      "sos",
      "help",
      "emergency"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🆙",
    "name": "UP! button",
    "keywords": [
      "up"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🆚",
    "name": "VS button",
    "keywords": [
      "vs"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🈁",
    "name": "Japanese “here” button",
    "keywords": [
      "koko"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🈂️",
    "name": "Japanese “service charge” button",
    "keywords": [
      "sa"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🈷️",
    "name": "Japanese “monthly amount” button",
    "keywords": [
      "u6708"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🈶",
    "name": "Japanese “not free of charge” button",
    "keywords": [
      "u6709"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🈯",
    "name": "Japanese “reserved” button",
    "keywords": [
      "u6307"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🉐",
    "name": "Japanese “bargain” button",
    "keywords": [
      "ideograph_advantage"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🈹",
    "name": "Japanese “discount” button",
    "keywords": [
      "u5272"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🈚",
    "name": "Japanese “free of charge” button",
    "keywords": [
      "u7121"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🈲",
    "name": "Japanese “prohibited” button",
    "keywords": [
      "u7981"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🉑",
    "name": "Japanese “acceptable” button",
    "keywords": [
      "accept"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🈸",
    "name": "Japanese “application” button",
    "keywords": [
      "u7533"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🈴",
    "name": "Japanese “passing grade” button",
    "keywords": [
      "u5408"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🈳",
    "name": "Japanese “vacancy” button",
    "keywords": [
      "u7a7a"
    ],
    "category": "symbols"
  },
  {
    "glyph": "㊗️",
    "name": "Japanese “congratulations” button",
    "keywords": [
      "congratulations"
    ],
    "category": "symbols"
  },
  {
    "glyph": "㊙️",
    "name": "Japanese “secret” button",
    "keywords": [
      "secret"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🈺",
    "name": "Japanese “open for business” button",
    "keywords": [
      "u55b6"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🈵",
    "name": "Japanese “no vacancy” button",
    "keywords": [
      "u6e80"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔴",
    "name": "red circle",
    "keywords": [
      "red_circle"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🟠",
    "name": "orange circle",
    "keywords": [
      "orange_circle"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🟡",
    "name": "yellow circle",
    "keywords": [
      "yellow_circle"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🟢",
    "name": "green circle",
    "keywords": [
      "green_circle"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔵",
    "name": "blue circle",
    "keywords": [
      "large_blue_circle"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🟣",
    "name": "purple circle",
    "keywords": [
      "purple_circle"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🟤",
    "name": "brown circle",
    "keywords": [
      "brown_circle"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⚫",
    "name": "black circle",
    "keywords": [
      "black_circle"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⚪",
    "name": "white circle",
    "keywords": [
      "white_circle"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🟥",
    "name": "red square",
    "keywords": [
      "red_square"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🟧",
    "name": "orange square",
    "keywords": [
      "orange_square"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🟨",
    "name": "yellow square",
    "keywords": [
      "yellow_square"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🟩",
    "name": "green square",
    "keywords": [
      "green_square"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🟦",
    "name": "blue square",
    "keywords": [
      "blue_square"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🟪",
    "name": "purple square",
    "keywords": [
      "purple_square"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🟫",
    "name": "brown square",
    "keywords": [
      "brown_square"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⬛",
    "name": "black large square",
    "keywords": [
      "black_large_square"
    ],
    "category": "symbols"
  },
  {
    "glyph": "⬜",
    "name": "white large square",
    "keywords": [
      "white_large_square"
    ],
    "category": "symbols"
  },
  {
    "glyph": "◼️",
    "name": "black medium square",
    "keywords": [
      "black_medium_square"
    ],
    "category": "symbols"
  },
  {
    "glyph": "◻️",
    "name": "white medium square",
    "keywords": [
      "white_medium_square"
    ],
    "category": "symbols"
  },
  {
    "glyph": "◾",
    "name": "black medium-small square",
    "keywords": [
      "black_medium_small_square"
    ],
    "category": "symbols"
  },
  {
    "glyph": "◽",
    "name": "white medium-small square",
    "keywords": [
      "white_medium_small_square"
    ],
    "category": "symbols"
  },
  {
    "glyph": "▪️",
    "name": "black small square",
    "keywords": [
      "black_small_square"
    ],
    "category": "symbols"
  },
  {
    "glyph": "▫️",
    "name": "white small square",
    "keywords": [
      "white_small_square"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔶",
    "name": "large orange diamond",
    "keywords": [
      "large_orange_diamond"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔷",
    "name": "large blue diamond",
    "keywords": [
      "large_blue_diamond"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔸",
    "name": "small orange diamond",
    "keywords": [
      "small_orange_diamond"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔹",
    "name": "small blue diamond",
    "keywords": [
      "small_blue_diamond"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔺",
    "name": "red triangle pointed up",
    "keywords": [
      "small_red_triangle"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔻",
    "name": "red triangle pointed down",
    "keywords": [
      "small_red_triangle_down"
    ],
    "category": "symbols"
  },
  {
    "glyph": "💠",
    "name": "diamond with a dot",
    "keywords": [
      "diamond_shape_with_a_dot_inside"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔘",
    "name": "radio button",
    "keywords": [
      "radio_button"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔳",
    "name": "white square button",
    "keywords": [
      "white_square_button"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🔲",
    "name": "black square button",
    "keywords": [
      "black_square_button"
    ],
    "category": "symbols"
  },
  {
    "glyph": "🏁",
    "name": "chequered flag",
    "keywords": [
      "checkered_flag",
      "milestone",
      "finish"
    ],
    "category": "flags"
  },
  {
    "glyph": "🚩",
    "name": "triangular flag",
    "keywords": [
      "triangular_flag_on_post"
    ],
    "category": "flags"
  },
  {
    "glyph": "🎌",
    "name": "crossed flags",
    "keywords": [
      "crossed_flags"
    ],
    "category": "flags"
  },
  {
    "glyph": "🏴",
    "name": "black flag",
    "keywords": [
      "black_flag"
    ],
    "category": "flags"
  },
  {
    "glyph": "🏳️",
    "name": "white flag",
    "keywords": [
      "white_flag"
    ],
    "category": "flags"
  },
  {
    "glyph": "🏳️‍🌈",
    "name": "rainbow flag",
    "keywords": [
      "rainbow_flag",
      "pride"
    ],
    "category": "flags"
  },
  {
    "glyph": "🏳️‍⚧️",
    "name": "transgender flag",
    "keywords": [
      "transgender_flag"
    ],
    "category": "flags"
  },
  {
    "glyph": "🏴‍☠️",
    "name": "pirate flag",
    "keywords": [
      "pirate_flag"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇦🇨",
    "name": "flag: Ascension Island",
    "keywords": [
      "ascension_island"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇦🇩",
    "name": "flag: Andorra",
    "keywords": [
      "andorra"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇦🇪",
    "name": "flag: United Arab Emirates",
    "keywords": [
      "united_arab_emirates"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇦🇫",
    "name": "flag: Afghanistan",
    "keywords": [
      "afghanistan"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇦🇬",
    "name": "flag: Antigua & Barbuda",
    "keywords": [
      "antigua_barbuda"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇦🇮",
    "name": "flag: Anguilla",
    "keywords": [
      "anguilla"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇦🇱",
    "name": "flag: Albania",
    "keywords": [
      "albania"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇦🇲",
    "name": "flag: Armenia",
    "keywords": [
      "armenia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇦🇴",
    "name": "flag: Angola",
    "keywords": [
      "angola"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇦🇶",
    "name": "flag: Antarctica",
    "keywords": [
      "antarctica"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇦🇷",
    "name": "flag: Argentina",
    "keywords": [
      "argentina"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇦🇸",
    "name": "flag: American Samoa",
    "keywords": [
      "american_samoa"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇦🇹",
    "name": "flag: Austria",
    "keywords": [
      "austria"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇦🇺",
    "name": "flag: Australia",
    "keywords": [
      "australia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇦🇼",
    "name": "flag: Aruba",
    "keywords": [
      "aruba"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇦🇽",
    "name": "flag: Åland Islands",
    "keywords": [
      "aland_islands"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇦🇿",
    "name": "flag: Azerbaijan",
    "keywords": [
      "azerbaijan"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇦",
    "name": "flag: Bosnia & Herzegovina",
    "keywords": [
      "bosnia_herzegovina"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇧",
    "name": "flag: Barbados",
    "keywords": [
      "barbados"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇩",
    "name": "flag: Bangladesh",
    "keywords": [
      "bangladesh"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇪",
    "name": "flag: Belgium",
    "keywords": [
      "belgium"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇫",
    "name": "flag: Burkina Faso",
    "keywords": [
      "burkina_faso"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇬",
    "name": "flag: Bulgaria",
    "keywords": [
      "bulgaria"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇭",
    "name": "flag: Bahrain",
    "keywords": [
      "bahrain"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇮",
    "name": "flag: Burundi",
    "keywords": [
      "burundi"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇯",
    "name": "flag: Benin",
    "keywords": [
      "benin"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇱",
    "name": "flag: St. Barthélemy",
    "keywords": [
      "st_barthelemy"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇲",
    "name": "flag: Bermuda",
    "keywords": [
      "bermuda"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇳",
    "name": "flag: Brunei",
    "keywords": [
      "brunei"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇴",
    "name": "flag: Bolivia",
    "keywords": [
      "bolivia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇶",
    "name": "flag: Caribbean Netherlands",
    "keywords": [
      "caribbean_netherlands"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇷",
    "name": "flag: Brazil",
    "keywords": [
      "brazil"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇸",
    "name": "flag: Bahamas",
    "keywords": [
      "bahamas"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇹",
    "name": "flag: Bhutan",
    "keywords": [
      "bhutan"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇻",
    "name": "flag: Bouvet Island",
    "keywords": [
      "bouvet_island"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇼",
    "name": "flag: Botswana",
    "keywords": [
      "botswana"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇾",
    "name": "flag: Belarus",
    "keywords": [
      "belarus"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇧🇿",
    "name": "flag: Belize",
    "keywords": [
      "belize"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇦",
    "name": "flag: Canada",
    "keywords": [
      "canada"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇨",
    "name": "flag: Cocos (Keeling) Islands",
    "keywords": [
      "cocos_islands",
      "keeling"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇩",
    "name": "flag: Congo - Kinshasa",
    "keywords": [
      "congo_kinshasa"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇫",
    "name": "flag: Central African Republic",
    "keywords": [
      "central_african_republic"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇬",
    "name": "flag: Congo - Brazzaville",
    "keywords": [
      "congo_brazzaville"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇭",
    "name": "flag: Switzerland",
    "keywords": [
      "switzerland"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇮",
    "name": "flag: Côte d’Ivoire",
    "keywords": [
      "cote_divoire",
      "ivory"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇰",
    "name": "flag: Cook Islands",
    "keywords": [
      "cook_islands"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇱",
    "name": "flag: Chile",
    "keywords": [
      "chile"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇲",
    "name": "flag: Cameroon",
    "keywords": [
      "cameroon"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇳",
    "name": "flag: China",
    "keywords": [
      "cn",
      "china"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇴",
    "name": "flag: Colombia",
    "keywords": [
      "colombia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇵",
    "name": "flag: Clipperton Island",
    "keywords": [
      "clipperton_island"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇷",
    "name": "flag: Costa Rica",
    "keywords": [
      "costa_rica"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇺",
    "name": "flag: Cuba",
    "keywords": [
      "cuba"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇻",
    "name": "flag: Cape Verde",
    "keywords": [
      "cape_verde"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇼",
    "name": "flag: Curaçao",
    "keywords": [
      "curacao"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇽",
    "name": "flag: Christmas Island",
    "keywords": [
      "christmas_island"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇾",
    "name": "flag: Cyprus",
    "keywords": [
      "cyprus"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇨🇿",
    "name": "flag: Czechia",
    "keywords": [
      "czech_republic"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇩🇪",
    "name": "flag: Germany",
    "keywords": [
      "de",
      "flag",
      "germany"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇩🇬",
    "name": "flag: Diego Garcia",
    "keywords": [
      "diego_garcia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇩🇯",
    "name": "flag: Djibouti",
    "keywords": [
      "djibouti"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇩🇰",
    "name": "flag: Denmark",
    "keywords": [
      "denmark"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇩🇲",
    "name": "flag: Dominica",
    "keywords": [
      "dominica"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇩🇴",
    "name": "flag: Dominican Republic",
    "keywords": [
      "dominican_republic"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇩🇿",
    "name": "flag: Algeria",
    "keywords": [
      "algeria"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇪🇦",
    "name": "flag: Ceuta & Melilla",
    "keywords": [
      "ceuta_melilla"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇪🇨",
    "name": "flag: Ecuador",
    "keywords": [
      "ecuador"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇪🇪",
    "name": "flag: Estonia",
    "keywords": [
      "estonia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇪🇬",
    "name": "flag: Egypt",
    "keywords": [
      "egypt"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇪🇭",
    "name": "flag: Western Sahara",
    "keywords": [
      "western_sahara"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇪🇷",
    "name": "flag: Eritrea",
    "keywords": [
      "eritrea"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇪🇸",
    "name": "flag: Spain",
    "keywords": [
      "es",
      "spain"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇪🇹",
    "name": "flag: Ethiopia",
    "keywords": [
      "ethiopia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇪🇺",
    "name": "flag: European Union",
    "keywords": [
      "eu",
      "european_union"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇫🇮",
    "name": "flag: Finland",
    "keywords": [
      "finland"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇫🇯",
    "name": "flag: Fiji",
    "keywords": [
      "fiji"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇫🇰",
    "name": "flag: Falkland Islands",
    "keywords": [
      "falkland_islands"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇫🇲",
    "name": "flag: Micronesia",
    "keywords": [
      "micronesia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇫🇴",
    "name": "flag: Faroe Islands",
    "keywords": [
      "faroe_islands"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇫🇷",
    "name": "flag: France",
    "keywords": [
      "fr",
      "france",
      "french"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇦",
    "name": "flag: Gabon",
    "keywords": [
      "gabon"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇧",
    "name": "flag: United Kingdom",
    "keywords": [
      "gb",
      "uk",
      "flag",
      "british"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇩",
    "name": "flag: Grenada",
    "keywords": [
      "grenada"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇪",
    "name": "flag: Georgia",
    "keywords": [
      "georgia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇫",
    "name": "flag: French Guiana",
    "keywords": [
      "french_guiana"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇬",
    "name": "flag: Guernsey",
    "keywords": [
      "guernsey"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇭",
    "name": "flag: Ghana",
    "keywords": [
      "ghana"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇮",
    "name": "flag: Gibraltar",
    "keywords": [
      "gibraltar"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇱",
    "name": "flag: Greenland",
    "keywords": [
      "greenland"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇲",
    "name": "flag: Gambia",
    "keywords": [
      "gambia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇳",
    "name": "flag: Guinea",
    "keywords": [
      "guinea"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇵",
    "name": "flag: Guadeloupe",
    "keywords": [
      "guadeloupe"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇶",
    "name": "flag: Equatorial Guinea",
    "keywords": [
      "equatorial_guinea"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇷",
    "name": "flag: Greece",
    "keywords": [
      "greece"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇸",
    "name": "flag: South Georgia & South Sandwich Islands",
    "keywords": [
      "south_georgia_south_sandwich_islands"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇹",
    "name": "flag: Guatemala",
    "keywords": [
      "guatemala"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇺",
    "name": "flag: Guam",
    "keywords": [
      "guam"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇼",
    "name": "flag: Guinea-Bissau",
    "keywords": [
      "guinea_bissau"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇬🇾",
    "name": "flag: Guyana",
    "keywords": [
      "guyana"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇭🇰",
    "name": "flag: Hong Kong SAR China",
    "keywords": [
      "hong_kong"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇭🇲",
    "name": "flag: Heard & McDonald Islands",
    "keywords": [
      "heard_mcdonald_islands"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇭🇳",
    "name": "flag: Honduras",
    "keywords": [
      "honduras"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇭🇷",
    "name": "flag: Croatia",
    "keywords": [
      "croatia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇭🇹",
    "name": "flag: Haiti",
    "keywords": [
      "haiti"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇭🇺",
    "name": "flag: Hungary",
    "keywords": [
      "hungary"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇮🇨",
    "name": "flag: Canary Islands",
    "keywords": [
      "canary_islands"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇮🇩",
    "name": "flag: Indonesia",
    "keywords": [
      "indonesia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇮🇪",
    "name": "flag: Ireland",
    "keywords": [
      "ireland"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇮🇱",
    "name": "flag: Israel",
    "keywords": [
      "israel"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇮🇲",
    "name": "flag: Isle of Man",
    "keywords": [
      "isle_of_man"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇮🇳",
    "name": "flag: India",
    "keywords": [
      "india"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇮🇴",
    "name": "flag: British Indian Ocean Territory",
    "keywords": [
      "british_indian_ocean_territory"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇮🇶",
    "name": "flag: Iraq",
    "keywords": [
      "iraq"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇮🇷",
    "name": "flag: Iran",
    "keywords": [
      "iran"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇮🇸",
    "name": "flag: Iceland",
    "keywords": [
      "iceland"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇮🇹",
    "name": "flag: Italy",
    "keywords": [
      "it",
      "italy"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇯🇪",
    "name": "flag: Jersey",
    "keywords": [
      "jersey"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇯🇲",
    "name": "flag: Jamaica",
    "keywords": [
      "jamaica"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇯🇴",
    "name": "flag: Jordan",
    "keywords": [
      "jordan"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇯🇵",
    "name": "flag: Japan",
    "keywords": [
      "jp",
      "japan"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇰🇪",
    "name": "flag: Kenya",
    "keywords": [
      "kenya"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇰🇬",
    "name": "flag: Kyrgyzstan",
    "keywords": [
      "kyrgyzstan"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇰🇭",
    "name": "flag: Cambodia",
    "keywords": [
      "cambodia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇰🇮",
    "name": "flag: Kiribati",
    "keywords": [
      "kiribati"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇰🇲",
    "name": "flag: Comoros",
    "keywords": [
      "comoros"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇰🇳",
    "name": "flag: St. Kitts & Nevis",
    "keywords": [
      "st_kitts_nevis"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇰🇵",
    "name": "flag: North Korea",
    "keywords": [
      "north_korea"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇰🇷",
    "name": "flag: South Korea",
    "keywords": [
      "kr",
      "korea"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇰🇼",
    "name": "flag: Kuwait",
    "keywords": [
      "kuwait"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇰🇾",
    "name": "flag: Cayman Islands",
    "keywords": [
      "cayman_islands"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇰🇿",
    "name": "flag: Kazakhstan",
    "keywords": [
      "kazakhstan"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇱🇦",
    "name": "flag: Laos",
    "keywords": [
      "laos"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇱🇧",
    "name": "flag: Lebanon",
    "keywords": [
      "lebanon"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇱🇨",
    "name": "flag: St. Lucia",
    "keywords": [
      "st_lucia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇱🇮",
    "name": "flag: Liechtenstein",
    "keywords": [
      "liechtenstein"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇱🇰",
    "name": "flag: Sri Lanka",
    "keywords": [
      "sri_lanka"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇱🇷",
    "name": "flag: Liberia",
    "keywords": [
      "liberia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇱🇸",
    "name": "flag: Lesotho",
    "keywords": [
      "lesotho"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇱🇹",
    "name": "flag: Lithuania",
    "keywords": [
      "lithuania"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇱🇺",
    "name": "flag: Luxembourg",
    "keywords": [
      "luxembourg"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇱🇻",
    "name": "flag: Latvia",
    "keywords": [
      "latvia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇱🇾",
    "name": "flag: Libya",
    "keywords": [
      "libya"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇦",
    "name": "flag: Morocco",
    "keywords": [
      "morocco"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇨",
    "name": "flag: Monaco",
    "keywords": [
      "monaco"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇩",
    "name": "flag: Moldova",
    "keywords": [
      "moldova"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇪",
    "name": "flag: Montenegro",
    "keywords": [
      "montenegro"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇫",
    "name": "flag: St. Martin",
    "keywords": [
      "st_martin"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇬",
    "name": "flag: Madagascar",
    "keywords": [
      "madagascar"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇭",
    "name": "flag: Marshall Islands",
    "keywords": [
      "marshall_islands"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇰",
    "name": "flag: North Macedonia",
    "keywords": [
      "macedonia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇱",
    "name": "flag: Mali",
    "keywords": [
      "mali"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇲",
    "name": "flag: Myanmar (Burma)",
    "keywords": [
      "myanmar",
      "burma"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇳",
    "name": "flag: Mongolia",
    "keywords": [
      "mongolia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇴",
    "name": "flag: Macao SAR China",
    "keywords": [
      "macau"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇵",
    "name": "flag: Northern Mariana Islands",
    "keywords": [
      "northern_mariana_islands"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇶",
    "name": "flag: Martinique",
    "keywords": [
      "martinique"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇷",
    "name": "flag: Mauritania",
    "keywords": [
      "mauritania"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇸",
    "name": "flag: Montserrat",
    "keywords": [
      "montserrat"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇹",
    "name": "flag: Malta",
    "keywords": [
      "malta"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇺",
    "name": "flag: Mauritius",
    "keywords": [
      "mauritius"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇻",
    "name": "flag: Maldives",
    "keywords": [
      "maldives"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇼",
    "name": "flag: Malawi",
    "keywords": [
      "malawi"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇽",
    "name": "flag: Mexico",
    "keywords": [
      "mexico"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇾",
    "name": "flag: Malaysia",
    "keywords": [
      "malaysia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇲🇿",
    "name": "flag: Mozambique",
    "keywords": [
      "mozambique"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇳🇦",
    "name": "flag: Namibia",
    "keywords": [
      "namibia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇳🇨",
    "name": "flag: New Caledonia",
    "keywords": [
      "new_caledonia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇳🇪",
    "name": "flag: Niger",
    "keywords": [
      "niger"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇳🇫",
    "name": "flag: Norfolk Island",
    "keywords": [
      "norfolk_island"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇳🇬",
    "name": "flag: Nigeria",
    "keywords": [
      "nigeria"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇳🇮",
    "name": "flag: Nicaragua",
    "keywords": [
      "nicaragua"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇳🇱",
    "name": "flag: Netherlands",
    "keywords": [
      "netherlands"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇳🇴",
    "name": "flag: Norway",
    "keywords": [
      "norway"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇳🇵",
    "name": "flag: Nepal",
    "keywords": [
      "nepal"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇳🇷",
    "name": "flag: Nauru",
    "keywords": [
      "nauru"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇳🇺",
    "name": "flag: Niue",
    "keywords": [
      "niue"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇳🇿",
    "name": "flag: New Zealand",
    "keywords": [
      "new_zealand"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇴🇲",
    "name": "flag: Oman",
    "keywords": [
      "oman"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇵🇦",
    "name": "flag: Panama",
    "keywords": [
      "panama"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇵🇪",
    "name": "flag: Peru",
    "keywords": [
      "peru"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇵🇫",
    "name": "flag: French Polynesia",
    "keywords": [
      "french_polynesia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇵🇬",
    "name": "flag: Papua New Guinea",
    "keywords": [
      "papua_new_guinea"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇵🇭",
    "name": "flag: Philippines",
    "keywords": [
      "philippines"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇵🇰",
    "name": "flag: Pakistan",
    "keywords": [
      "pakistan"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇵🇱",
    "name": "flag: Poland",
    "keywords": [
      "poland"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇵🇲",
    "name": "flag: St. Pierre & Miquelon",
    "keywords": [
      "st_pierre_miquelon"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇵🇳",
    "name": "flag: Pitcairn Islands",
    "keywords": [
      "pitcairn_islands"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇵🇷",
    "name": "flag: Puerto Rico",
    "keywords": [
      "puerto_rico"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇵🇸",
    "name": "flag: Palestinian Territories",
    "keywords": [
      "palestinian_territories"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇵🇹",
    "name": "flag: Portugal",
    "keywords": [
      "portugal"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇵🇼",
    "name": "flag: Palau",
    "keywords": [
      "palau"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇵🇾",
    "name": "flag: Paraguay",
    "keywords": [
      "paraguay"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇶🇦",
    "name": "flag: Qatar",
    "keywords": [
      "qatar"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇷🇪",
    "name": "flag: Réunion",
    "keywords": [
      "reunion"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇷🇴",
    "name": "flag: Romania",
    "keywords": [
      "romania"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇷🇸",
    "name": "flag: Serbia",
    "keywords": [
      "serbia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇷🇺",
    "name": "flag: Russia",
    "keywords": [
      "ru",
      "russia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇷🇼",
    "name": "flag: Rwanda",
    "keywords": [
      "rwanda"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇦",
    "name": "flag: Saudi Arabia",
    "keywords": [
      "saudi_arabia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇧",
    "name": "flag: Solomon Islands",
    "keywords": [
      "solomon_islands"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇨",
    "name": "flag: Seychelles",
    "keywords": [
      "seychelles"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇩",
    "name": "flag: Sudan",
    "keywords": [
      "sudan"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇪",
    "name": "flag: Sweden",
    "keywords": [
      "sweden"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇬",
    "name": "flag: Singapore",
    "keywords": [
      "singapore"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇭",
    "name": "flag: St. Helena",
    "keywords": [
      "st_helena"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇮",
    "name": "flag: Slovenia",
    "keywords": [
      "slovenia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇯",
    "name": "flag: Svalbard & Jan Mayen",
    "keywords": [
      "svalbard_jan_mayen"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇰",
    "name": "flag: Slovakia",
    "keywords": [
      "slovakia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇱",
    "name": "flag: Sierra Leone",
    "keywords": [
      "sierra_leone"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇲",
    "name": "flag: San Marino",
    "keywords": [
      "san_marino"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇳",
    "name": "flag: Senegal",
    "keywords": [
      "senegal"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇴",
    "name": "flag: Somalia",
    "keywords": [
      "somalia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇷",
    "name": "flag: Suriname",
    "keywords": [
      "suriname"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇸",
    "name": "flag: South Sudan",
    "keywords": [
      "south_sudan"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇹",
    "name": "flag: São Tomé & Príncipe",
    "keywords": [
      "sao_tome_principe"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇻",
    "name": "flag: El Salvador",
    "keywords": [
      "el_salvador"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇽",
    "name": "flag: Sint Maarten",
    "keywords": [
      "sint_maarten"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇾",
    "name": "flag: Syria",
    "keywords": [
      "syria"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇸🇿",
    "name": "flag: Eswatini",
    "keywords": [
      "swaziland"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇹🇦",
    "name": "flag: Tristan da Cunha",
    "keywords": [
      "tristan_da_cunha"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇹🇨",
    "name": "flag: Turks & Caicos Islands",
    "keywords": [
      "turks_caicos_islands"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇹🇩",
    "name": "flag: Chad",
    "keywords": [
      "chad"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇹🇫",
    "name": "flag: French Southern Territories",
    "keywords": [
      "french_southern_territories"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇹🇬",
    "name": "flag: Togo",
    "keywords": [
      "togo"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇹🇭",
    "name": "flag: Thailand",
    "keywords": [
      "thailand"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇹🇯",
    "name": "flag: Tajikistan",
    "keywords": [
      "tajikistan"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇹🇰",
    "name": "flag: Tokelau",
    "keywords": [
      "tokelau"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇹🇱",
    "name": "flag: Timor-Leste",
    "keywords": [
      "timor_leste"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇹🇲",
    "name": "flag: Turkmenistan",
    "keywords": [
      "turkmenistan"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇹🇳",
    "name": "flag: Tunisia",
    "keywords": [
      "tunisia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇹🇴",
    "name": "flag: Tonga",
    "keywords": [
      "tonga"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇹🇷",
    "name": "flag: Turkey",
    "keywords": [
      "tr",
      "turkey"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇹🇹",
    "name": "flag: Trinidad & Tobago",
    "keywords": [
      "trinidad_tobago"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇹🇻",
    "name": "flag: Tuvalu",
    "keywords": [
      "tuvalu"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇹🇼",
    "name": "flag: Taiwan",
    "keywords": [
      "taiwan"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇹🇿",
    "name": "flag: Tanzania",
    "keywords": [
      "tanzania"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇺🇦",
    "name": "flag: Ukraine",
    "keywords": [
      "ukraine"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇺🇬",
    "name": "flag: Uganda",
    "keywords": [
      "uganda"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇺🇲",
    "name": "flag: U.S. Outlying Islands",
    "keywords": [
      "us_outlying_islands"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇺🇳",
    "name": "flag: United Nations",
    "keywords": [
      "united_nations"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇺🇸",
    "name": "flag: United States",
    "keywords": [
      "us",
      "flag",
      "united",
      "america"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇺🇾",
    "name": "flag: Uruguay",
    "keywords": [
      "uruguay"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇺🇿",
    "name": "flag: Uzbekistan",
    "keywords": [
      "uzbekistan"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇻🇦",
    "name": "flag: Vatican City",
    "keywords": [
      "vatican_city"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇻🇨",
    "name": "flag: St. Vincent & Grenadines",
    "keywords": [
      "st_vincent_grenadines"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇻🇪",
    "name": "flag: Venezuela",
    "keywords": [
      "venezuela"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇻🇬",
    "name": "flag: British Virgin Islands",
    "keywords": [
      "british_virgin_islands"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇻🇮",
    "name": "flag: U.S. Virgin Islands",
    "keywords": [
      "us_virgin_islands"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇻🇳",
    "name": "flag: Vietnam",
    "keywords": [
      "vietnam"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇻🇺",
    "name": "flag: Vanuatu",
    "keywords": [
      "vanuatu"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇼🇫",
    "name": "flag: Wallis & Futuna",
    "keywords": [
      "wallis_futuna"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇼🇸",
    "name": "flag: Samoa",
    "keywords": [
      "samoa"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇽🇰",
    "name": "flag: Kosovo",
    "keywords": [
      "kosovo"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇾🇪",
    "name": "flag: Yemen",
    "keywords": [
      "yemen"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇾🇹",
    "name": "flag: Mayotte",
    "keywords": [
      "mayotte"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇿🇦",
    "name": "flag: South Africa",
    "keywords": [
      "south_africa"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇿🇲",
    "name": "flag: Zambia",
    "keywords": [
      "zambia"
    ],
    "category": "flags"
  },
  {
    "glyph": "🇿🇼",
    "name": "flag: Zimbabwe",
    "keywords": [
      "zimbabwe"
    ],
    "category": "flags"
  },
  {
    "glyph": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    "name": "flag: England",
    "keywords": [
      "england"
    ],
    "category": "flags"
  },
  {
    "glyph": "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
    "name": "flag: Scotland",
    "keywords": [
      "scotland"
    ],
    "category": "flags"
  },
  {
    "glyph": "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
    "name": "flag: Wales",
    "keywords": [
      "wales"
    ],
    "category": "flags"
  }
] as unknown as EmojiEntry[];
