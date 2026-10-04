data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  eb_bucket  = "elasticbeanstalk-${var.aws_region}-${local.account_id}"
  eb_app_arn = "arn:aws:elasticbeanstalk:${var.aws_region}:${local.account_id}:application/sigmetum-backend-${var.environment}"
  eb_env_arn = "arn:aws:elasticbeanstalk:${var.aws_region}:${local.account_id}:environment/sigmetum-backend-${var.environment}/sigmetum-backend-${var.environment}-env"
}

# ── GitHub OIDC provider (account-level, one per AWS account) ─────────────────
resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  # GitHub's OIDC thumbprint (stable — GitHub rotates the cert but keeps this thumbprint valid)
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = { Component = "backend-ci" }
}

# ── IAM role ──────────────────────────────────────────────────────────────────
data "aws_iam_policy_document" "github_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:ref:refs/heads/${var.github_branch}"]
    }
  }
}

resource "aws_iam_role" "backend_ci" {
  name               = "sigmetum-backend-ci-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.github_trust.json

  tags = { Component = "backend-ci" }
}

data "aws_iam_policy_document" "backend_ci" {
  # Beanstalk staging bucket: CreateBucket in case it doesn't exist yet,
  # PutObject/GetObject for the source bundle
  statement {
    sid    = "EBStagingBucket"
    effect = "Allow"
    actions = [
      "s3:CreateBucket",
      "s3:PutObject",
      "s3:GetObject",
    ]
    resources = [
      "arn:aws:s3:::${local.eb_bucket}",
      "arn:aws:s3:::${local.eb_bucket}/*",
    ]
  }

  statement {
    sid    = "BeanstalkDeploy"
    effect = "Allow"
    actions = [
      "elasticbeanstalk:CreateApplicationVersion",
      "elasticbeanstalk:UpdateEnvironment",
      "elasticbeanstalk:CreateStorageLocation",
    ]
    resources = [
      local.eb_app_arn,
      local.eb_env_arn,
    ]
  }

  # DescribeEnvironments and DescribeEvents do not support resource-level restrictions
  statement {
    sid    = "BeanstalkDescribe"
    effect = "Allow"
    actions = [
      "elasticbeanstalk:DescribeEnvironments",
      "elasticbeanstalk:DescribeEvents",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "backend_ci" {
  name   = "sigmetum-backend-ci-${var.environment}"
  role   = aws_iam_role.backend_ci.id
  policy = data.aws_iam_policy_document.backend_ci.json
}
