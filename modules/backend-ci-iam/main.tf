data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
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

# ── CI deploy policy ──────────────────────────────────────────────────────────
# Derived from AdministratorAccess-AWSElasticBeanstalk v10 (May 2026),
# trimmed to services this project uses (no RDS, ECS, CodeBuild).
data "aws_iam_policy_document" "backend_ci" {

  # Read-only actions that do not support resource-level restrictions
  statement {
    sid    = "EBReadOnly"
    effect = "Allow"
    actions = [
      "autoscaling:Describe*",
      "cloudformation:Describe*",
      "cloudformation:Estimate*",
      "cloudformation:Get*",
      "cloudformation:List*",
      "cloudformation:Validate*",
      "cloudwatch:DescribeAlarms",
      "cloudwatch:GetMetricStatistics",
      "cloudwatch:ListMetrics",
      "ec2:Describe*",
      "elasticbeanstalk:Describe*",
      "elasticloadbalancing:Describe*",
      "iam:GetRole",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfiles",
      "iam:ListRolePolicies",
      "iam:ListRoles",
      "logs:Describe*",
      "s3:ListAllMyBuckets",
      "sns:ListSubscriptionsByTopic",
      "sns:ListTopics",
    ]
    resources = ["*"]
  }

  # Elasticbeanstalk write — scoped to this app/env/version
  statement {
    sid    = "BeanstalkDeploy"
    effect = "Allow"
    actions = [
      "elasticbeanstalk:CreateApplicationVersion",
      "elasticbeanstalk:CreateStorageLocation",
      "elasticbeanstalk:UpdateEnvironment",
    ]
    resources = [
      local.eb_app_arn,
      local.eb_env_arn,
      "arn:aws:elasticbeanstalk:${var.aws_region}:${local.account_id}:applicationversion/sigmetum-backend-${var.environment}/*",
    ]
  }

  # S3 objects in any elasticbeanstalk-* bucket (CF reads templates from here)
  statement {
    sid    = "EBBucketObjects"
    effect = "Allow"
    actions = [
      "s3:Delete*",
      "s3:Get*",
      "s3:Put*",
    ]
    resources = ["arn:aws:s3:::elasticbeanstalk-*/*"]
  }

  # S3 bucket-level operations on elasticbeanstalk-* buckets
  statement {
    sid    = "EBBucketLevel"
    effect = "Allow"
    actions = [
      "s3:CreateBucket",
      "s3:GetBucket*",
      "s3:ListBucket",
      "s3:PutBucketPolicy",
      "s3:PutBucketPublicAccessBlock",
      "s3:PutBucketOwnershipControls",
    ]
    resources = ["arn:aws:s3:::elasticbeanstalk-*"]
  }

  # CloudFormation write on awseb-* stacks (EB manages these internally)
  statement {
    sid    = "EBCloudFormation"
    effect = "Allow"
    actions = [
      "cloudformation:CancelUpdateStack",
      "cloudformation:ContinueUpdateRollback",
      "cloudformation:CreateStack",
      "cloudformation:DeleteStack",
      "cloudformation:GetTemplate",
      "cloudformation:ListStackResources",
      "cloudformation:SignalResource",
      "cloudformation:TagResource",
      "cloudformation:UntagResource",
      "cloudformation:UpdateStack",
    ]
    resources = [
      "arn:aws:cloudformation:${var.aws_region}:${local.account_id}:stack/awseb-*",
    ]
  }

  # AutoScaling write scoped to EB-managed resources
  statement {
    sid     = "EBAutoScaling"
    effect  = "Allow"
    actions = ["autoscaling:*"]
    resources = [
      "arn:aws:autoscaling:${var.aws_region}:${local.account_id}:launchConfiguration:*:launchConfigurationName/awseb-e-*",
      "arn:aws:autoscaling:${var.aws_region}:${local.account_id}:autoScalingGroup:*:autoScalingGroupName/awseb-e-*",
    ]
  }

  # CloudWatch alarms scoped to awseb-* (EB creates these for scaling)
  statement {
    sid    = "EBCloudWatchAlarms"
    effect = "Allow"
    actions = [
      "cloudwatch:DeleteAlarms",
      "cloudwatch:PutMetricAlarm",
    ]
    resources = [
      "arn:aws:cloudwatch:${var.aws_region}:${local.account_id}:alarm:awseb-*",
    ]
  }

  # SNS notifications topic for this environment
  statement {
    sid    = "EBSns"
    effect = "Allow"
    actions = [
      "sns:CreateTopic",
      "sns:DeleteTopic",
      "sns:GetTopicAttributes",
      "sns:Publish",
      "sns:SetTopicAttributes",
      "sns:Subscribe",
      "sns:Unsubscribe",
    ]
    resources = [
      "arn:aws:sns:${var.aws_region}:${local.account_id}:ElasticBeanstalkNotifications-*",
    ]
  }

  # CloudWatch Logs for EB log groups
  statement {
    sid    = "EBLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:DeleteLogGroup",
      "logs:PutRetentionPolicy",
    ]
    resources = [
      "arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:/aws/elasticbeanstalk/*",
    ]
  }

  # PassRole to EB/EC2/ASG/ELB/CF — condition limits scope to EB-related services
  statement {
    sid     = "EBPassRole"
    effect  = "Allow"
    actions = ["iam:PassRole"]
    resources = [
      "arn:aws:iam::${local.account_id}:role/aws-elasticbeanstalk*",
    ]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values = [
        "elasticbeanstalk.amazonaws.com",
        "ec2.amazonaws.com",
        "autoscaling.amazonaws.com",
        "elasticloadbalancing.amazonaws.com",
        "cloudformation.amazonaws.com",
      ]
    }
  }

  # Create service-linked roles that EB needs if they don't exist yet
  statement {
    sid     = "EBServiceLinkedRoles"
    effect  = "Allow"
    actions = ["iam:CreateServiceLinkedRole"]
    resources = [
      "arn:aws:iam::${local.account_id}:role/aws-service-role/autoscaling.amazonaws.com/AWSServiceRoleForAutoScaling",
      "arn:aws:iam::${local.account_id}:role/aws-service-role/elasticbeanstalk.amazonaws.com/AWSServiceRoleForElasticBeanstalk",
      "arn:aws:iam::${local.account_id}:role/aws-service-role/elasticloadbalancing.amazonaws.com/AWSServiceRoleForElasticLoadBalancing",
    ]
    condition {
      test     = "StringLike"
      variable = "iam:AWSServiceName"
      values = [
        "autoscaling.amazonaws.com",
        "elasticbeanstalk.amazonaws.com",
        "elasticloadbalancing.amazonaws.com",
      ]
    }
  }
}

resource "aws_iam_role_policy" "backend_ci" {
  name   = "sigmetum-backend-ci-${var.environment}"
  role   = aws_iam_role.backend_ci.id
  policy = data.aws_iam_policy_document.backend_ci.json
}
