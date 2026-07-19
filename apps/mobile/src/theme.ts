import { Platform } from "react-native";

export const colors = {
  fog: "#EAF2EF",
  paper: "#F8FAF8",
  white: "#FFFFFF",
  ink: "#17272C",
  slate: "#52666B",
  muted: "#7A8B8E",
  mineral: "#286070",
  mineralDark: "#174653",
  mineralSoft: "#D8E8E8",
  moss: "#4E9B5E",
  amber: "#EAAE48",
  amberSoft: "#F8EACB",
  plum: "#5E4967",
  line: "#D8E2DF",
  danger: "#9B3E3E",
  dangerSoft: "#F5E1DE",
} as const;

export const type = {
  display: "Lora_600SemiBold",
  body: Platform.select({ ios: "Avenir Next", android: "sans-serif", default: "sans-serif" }),
  mono: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
} as const;

export const radius = {
  small: 10,
  medium: 18,
  large: 28,
  pill: 999,
} as const;
