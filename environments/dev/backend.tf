# Remote state stored in the preprod account's S3 bucket.
# Create the bucket manually once before running terraform init:
#   aws s3api create-bucket --bucket sigmetum-tfstate-dev \
#     --region eu-west-3 \
#     --create-bucket-configuration LocationConstraint=eu-west-3
#
# Then enable versioning:
#   aws s3api put-bucket-versioning --bucket sigmetum-tfstate-dev \
#     --versioning-configuration Status=Enabled
#
# Run with: AWS_PROFILE=sigmetum-preprod terraform init

terraform {
  backend "s3" {
    bucket = "sigmetum-tfstate-dev"
    key    = "terraform.tfstate"
    region = "eu-west-3"
  }
}
