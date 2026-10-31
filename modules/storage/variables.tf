variable "environment" {
  description = "Deployment environment: dev or prod. Used in the names of the OAC and of the S3 access policy."
  type        = string
}

variable "bucket_name" {
  description = "S3 bucket name for app assets and JSON data"
  type        = string
}
