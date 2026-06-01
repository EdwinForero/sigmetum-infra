# Remote state stored in S3.
# Create the bucket manually once before running terraform init:
#   aws s3api create-bucket --bucket sigmetum-tfstate \
#     --region eu-west-3 \
#     --create-bucket-configuration LocationConstraint=eu-west-3
#
# Then enable versioning:
#   aws s3api put-bucket-versioning --bucket sigmetum-tfstate \
#     --versioning-configuration Status=Enabled

terraform {
  backend "s3" {
    bucket = "sigmetum-tfstate"
    key    = "dev/terraform.tfstate"
    region = "eu-west-3"
  }
}
