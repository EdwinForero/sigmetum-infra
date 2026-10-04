# Remote state stored in the prod account's S3 bucket.
# Create the bucket manually once before running terraform init:
#   aws s3api create-bucket --bucket sigmetum-state-prod \
#     --region eu-west-3 \
#     --create-bucket-configuration LocationConstraint=eu-west-3
#
# Then enable versioning:
#   aws s3api put-bucket-versioning --bucket sigmetum-state-prod \
#     --versioning-configuration Status=Enabled
#
# Run with: AWS_PROFILE=sigmetum-prod terraform init

terraform {
  backend "s3" {
    bucket = "sigmetum-state-prod"
    key    = "terraform.tfstate"
    region = "eu-west-3"
  }
}
