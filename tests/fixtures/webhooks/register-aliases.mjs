// Install the repo alias resolver before producer.mjs is evaluated.
import { register } from "node:module";

register("./alias-hooks.mjs", import.meta.url);
