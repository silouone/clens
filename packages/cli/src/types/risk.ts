export type RiskLevel = "low" | "medium" | "high";

export interface FileRiskScore {
	readonly file_path: string;
	readonly risk_level: RiskLevel;
	readonly backtrack_count: number;
	readonly abandoned_edit_count: number;
	readonly total_edit_count: number;
	readonly failure_rate: number;
	readonly edit_chain_length: number;
}
