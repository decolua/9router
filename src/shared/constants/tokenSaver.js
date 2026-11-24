export const TOKEN_SAVER_MODULES = [
  { field: "rtkEnabled", label: "RTK" },
  { field: "headroomEnabled", label: "Headroom" },
  { field: "cavemanEnabled", label: "Caveman" },
  { field: "ponytailEnabled", label: "Ponytail" },
];

export const TOKEN_SAVER_POLICY_FIELDS = [
  "overrideEnabled", "enabled", ...TOKEN_SAVER_MODULES.map(({ field }) => field),
];
