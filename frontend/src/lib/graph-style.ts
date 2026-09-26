// Shared by the canvas, legend, and keyboard-accessible entity list.
export const graphColor = (type: string) => ({
  method: "#6ee7b7", concept: "#a5b4fc", evidence: "#fcd34d",
  person: "#f9a8d4", organization: "#7dd3fc", paper: "#fdba74",
}[type.toLowerCase()] ?? "#cbd5e1");
