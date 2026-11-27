import Input from "@/shared/components/Input";
import Select from "@/shared/components/Select";

export default function AzureDeploymentPoolFields({ data, onChange }) {
  return (
    <>
      <Select
        label="Deployment Routing"
        value={data.deploymentMode}
        onChange={(event) => onChange({ ...data, deploymentMode: event.target.value })}
        options={[
          { value: "fixed", label: "Single deployment" },
          { value: "pool", label: "Deployment pool" },
        ]}
      />
      {data.deploymentMode === "pool" && (
        <Input
          label="Deployment Names"
          value={data.deploymentNames}
          onChange={(event) => onChange({ ...data, deploymentNames: event.target.value })}
          hint="Enter the Azure deployment names separated by commas."
        />
      )}
    </>
  );
}
