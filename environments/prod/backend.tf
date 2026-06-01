# Remote state stored in the prod account's S3 bucket.
# Create the bucket manually once before running terraform init:
#   aws s3api create-bucket --bucket sigmetum-tfstate-prod \
#     --region eu-west-1 \
#     --create-bucket-configuration LocationConstraint=eu-west-1
#
# Then enable versioning:
#   aws s3api put-bucket-versioning --bucket sigmetum-tfstate-prod \
#     --versioning-configuration Status=Enabled
#
# Run with: AWS_PROFILE=sigmetum-prod terraform init

terraform {
  backend "s3" {
    bucket = "sigmetum-tfstate-prod"
    key    = "terraform.tfstate"
    region = "eu-west-1"
  }
}
