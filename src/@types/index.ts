export interface Message {
  role: string;
  content: string;
  parentId?: string; // Assume each responses has several mesages. e.g. sequential thinking and tool calls.
  isFinalMessage?: boolean; // Whether the message is the final output of the response.
  isToolCall?: boolean; // Whether the message is a tool call.
  displayMessage?: boolean; // Whether to display the message in Chat UI.
}

