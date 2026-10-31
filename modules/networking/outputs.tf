output "vpc_id" {
  description = "ID of the default VPC."
  value       = data.aws_vpc.default.id
}

output "subnet_ids" {
  description = "IDs of the default subnets, one per availability zone."
  value       = data.aws_subnets.default.ids
}
