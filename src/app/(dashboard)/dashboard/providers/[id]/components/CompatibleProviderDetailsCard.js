import { Button, Card } from "@/shared/components";

export default function CompatibleProviderDetailsCard({
  isAnthropicCompatible,
  providerNode,
  onAddApiKey,
  onEdit,
  onDelete,
}) {
  return (
    <Card>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">
            {isAnthropicCompatible
              ? "Anthropic Compatible Details"
              : "OpenAI Compatible Details"}
          </h2>
          <p className="break-all text-sm text-text-muted">
            {isAnthropicCompatible
              ? "Messages API"
              : providerNode.apiType === "responses"
                ? "Responses API"
                : "Chat Completions"}{" "}
            · {(providerNode.baseUrl || "").replace(/\/$/, "")}/
            {isAnthropicCompatible
              ? "messages"
              : providerNode.apiType === "responses"
                ? "responses"
                : "chat/completions"}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
          <Button
            size="sm"
            icon="add"
            onClick={onAddApiKey}
            className="w-full sm:w-auto"
          >
            Add API Key
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="edit"
            onClick={onEdit}
            className="w-full sm:w-auto"
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="delete"
            onClick={onDelete}
            className="w-full sm:w-auto"
          >
            Delete
          </Button>
        </div>
      </div>
    </Card>
  );
}
