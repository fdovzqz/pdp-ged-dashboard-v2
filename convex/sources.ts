import { query } from "./_generated/server";
import { JOB_TYPE_STAGES } from "./lib/pipelineStages";

/** Source descriptor for the Sources Catalog. */
export type SourceDescriptor = {
  sourceKey: string;
  label: string;
  description: string;
  tableOrTarget: string;
  jobTypes: { jobType: string; stages: string[] }[];
};

function sourceRows(): SourceDescriptor[] {
  const cloudwatchJobTypes = Object.entries(JOB_TYPE_STAGES)
    .filter(([jt]) => jt.startsWith("cloudwatch_"))
    .map(([jobType, stages]) => ({ jobType, stages: stages as unknown as string[] }));
  const datamappingJobTypes = Object.entries(JOB_TYPE_STAGES)
    .filter(([jt]) => jt.startsWith("datamapping_"))
    .map(([jobType, stages]) => ({ jobType, stages: stages as unknown as string[] }));

  return [
    {
      sourceKey: "cloudwatch",
      label: "CloudWatch",
      description:
        "Logs de pagos desde tres fuentes: V1, V2 y Payment. Dedup por referencia con prioridad Payment > V2 > V1. Tabla destino: paymentRecords.",
      tableOrTarget: "paymentRecords",
      jobTypes: cloudwatchJobTypes,
    },
    {
      sourceKey: "datamapping",
      label: "DynamoDB (datamapping)",
      description:
        "Registros de datamapping vía sync por syncGroup/updatedAt. Tabla destino: datamappingRecords.",
      tableOrTarget: "datamappingRecords",
      jobTypes: datamappingJobTypes,
    },
  ];
}

/** List extraction sources for the Sources Catalog. Data is derived from the pipeline job type registry. */
export const listSources = query({
  args: {},
  handler: async (): Promise<SourceDescriptor[]> => {
    return sourceRows();
  },
});
