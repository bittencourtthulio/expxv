import type { NomeTool } from "../catalogo";
import type { ImplTool } from "./comum";
import { handoffSubmit } from "./handoff";
import { missionComplete, missionList } from "./mission";
import { paneClose, paneList, paneRead, paneSend, paneSpawn } from "./pane";
import { catalogList, modelList, providerList } from "./provider";

export const IMPLEMENTACOES: Readonly<Record<NomeTool, ImplTool>> = {
  provider_list: providerList,
  model_list: modelList,
  pane_spawn: paneSpawn,
  pane_list: paneList,
  pane_read: paneRead,
  pane_send: paneSend,
  pane_close: paneClose,
  handoff_submit: handoffSubmit,
  mission_list: missionList,
  mission_complete: missionComplete,
  catalog_list: catalogList,
};
