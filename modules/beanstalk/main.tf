resource "aws_elastic_beanstalk_application" "this" {
  name = "sigmetum-backend-${var.environment}"

  tags = {
    Component = "backend"
  }
}

resource "aws_elastic_beanstalk_environment" "this" {
  name                = "sigmetum-backend-${var.environment}-env"
  application         = aws_elastic_beanstalk_application.this.name
  solution_stack_name = var.solution_stack_name
  tier                = "WebServer"

  tags = {
    Component = "backend"
  }

  # ── VPC ────────────────────────────────────────────────────────────────────
  setting {
    namespace = "aws:ec2:vpc"
    name      = "VPCId"
    value     = var.vpc_id
  }
  setting {
    namespace = "aws:ec2:vpc"
    name      = "Subnets"
    value     = join(",", var.subnet_ids)
  }
  setting {
    namespace = "aws:ec2:vpc"
    name      = "ELBSubnets"
    value     = join(",", var.subnet_ids)
  }
  setting {
    namespace = "aws:ec2:vpc"
    name      = "AssociatePublicIpAddress"
    value     = "true"
  }

  # ── EC2 instance ───────────────────────────────────────────────────────────
  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "InstanceType"
    value     = var.instance_type
  }
  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "IamInstanceProfile"
    value     = "aws-elasticbeanstalk-ec2-role"
  }
  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "DisableIMDSv1"
    value     = "true"
  }
  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "RootVolumeType"
    value     = "gp3"
  }
  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "RootVolumeSize"
    value     = "10"
  }

  # SSH: only enabled when a key pair is explicitly provided
  dynamic "setting" {
    for_each = var.ssh_key_name != "" ? [var.ssh_key_name] : []
    content {
      namespace = "aws:autoscaling:launchconfiguration"
      name      = "EC2KeyName"
      value     = setting.value
    }
  }
  dynamic "setting" {
    for_each = var.ssh_key_name != "" && length(var.ssh_allowed_cidrs) > 0 ? [join(",", var.ssh_allowed_cidrs)] : []
    content {
      namespace = "aws:autoscaling:launchconfiguration"
      name      = "SSHSourceRestriction"
      value     = "tcp,22,22,${setting.value}"
    }
  }

  # ── Auto scaling ───────────────────────────────────────────────────────────
  setting {
    namespace = "aws:autoscaling:asg"
    name      = "MinSize"
    value     = tostring(var.min_instances)
  }
  setting {
    namespace = "aws:autoscaling:asg"
    name      = "MaxSize"
    value     = tostring(var.max_instances)
  }
  setting {
    namespace = "aws:autoscaling:asg"
    name      = "Cooldown"
    value     = "360"
  }
  setting {
    namespace = "aws:autoscaling:asg"
    name      = "EnableCapacityRebalancing"
    value     = "false"
  }

  # Scaling trigger: CPU-based, same thresholds as existing config
  setting {
    namespace = "aws:autoscaling:trigger"
    name      = "MeasureName"
    value     = "CPUUtilization"
  }
  setting {
    namespace = "aws:autoscaling:trigger"
    name      = "Unit"
    value     = "Percent"
  }
  setting {
    namespace = "aws:autoscaling:trigger"
    name      = "LowerThreshold"
    value     = "50"
  }
  setting {
    namespace = "aws:autoscaling:trigger"
    name      = "UpperThreshold"
    value     = "80"
  }
  setting {
    namespace = "aws:autoscaling:trigger"
    name      = "LowerBreachScaleIncrement"
    value     = "-1"
  }
  setting {
    namespace = "aws:autoscaling:trigger"
    name      = "UpperBreachScaleIncrement"
    value     = "1"
  }

  # ── Load balancer ──────────────────────────────────────────────────────────
  setting {
    namespace = "aws:elasticbeanstalk:environment"
    name      = "LoadBalancerType"
    value     = var.load_balancer_type
  }
  setting {
    namespace = "aws:elasticbeanstalk:environment"
    name      = "ServiceRole"
    value     = "aws-elasticbeanstalk-service-role"
  }

  # HTTPS listener — only when ALB + cert provided
  dynamic "setting" {
    for_each = var.load_balancer_type == "application" && var.ssl_certificate_arn != "" ? {
      ListenerEnabled    = "true"
      Protocol           = "HTTPS"
      SSLCertificateArns = var.ssl_certificate_arn
      SSLPolicy          = "ELBSecurityPolicy-TLS13-1-2-2021-06"
    } : {}
    content {
      namespace = "aws:elbv2:listener:443"
      name      = setting.key
      value     = setting.value
    }
  }

  # ── Health check (target group via nginx → app on 8000) ───────────────────
  setting {
    namespace = "aws:elasticbeanstalk:environment:process:default"
    name      = "Port"
    value     = "80"
  }
  setting {
    namespace = "aws:elasticbeanstalk:environment:process:default"
    name      = "Protocol"
    value     = "HTTP"
  }
  setting {
    namespace = "aws:elasticbeanstalk:environment:process:default"
    name      = "HealthCheckPath"
    value     = "/"
  }
  setting {
    namespace = "aws:elasticbeanstalk:environment:process:default"
    name      = "HealthCheckInterval"
    value     = "15"
  }
  setting {
    namespace = "aws:elasticbeanstalk:environment:process:default"
    name      = "HealthCheckTimeout"
    value     = "5"
  }
  setting {
    namespace = "aws:elasticbeanstalk:environment:process:default"
    name      = "HealthyThresholdCount"
    value     = "3"
  }
  setting {
    namespace = "aws:elasticbeanstalk:environment:process:default"
    name      = "UnhealthyThresholdCount"
    value     = "5"
  }
  setting {
    namespace = "aws:elasticbeanstalk:environment:process:default"
    name      = "DeregistrationDelay"
    value     = "20"
  }

  # ── Health reporting ───────────────────────────────────────────────────────
  setting {
    namespace = "aws:elasticbeanstalk:healthreporting:system"
    name      = "SystemType"
    value     = "basic"
  }

  # ── Deployment policy ──────────────────────────────────────────────────────
  # prod (ALB): Rolling — one batch at a time, zero downtime
  # dev (single): AllAtOnce — no LB, rolling doesn't apply
  setting {
    namespace = "aws:elasticbeanstalk:command"
    name      = "DeploymentPolicy"
    value     = var.load_balancer_type == "application" ? "Rolling" : "AllAtOnce"
  }
  setting {
    namespace = "aws:elasticbeanstalk:command"
    name      = "BatchSizeType"
    value     = "Percentage"
  }
  setting {
    namespace = "aws:elasticbeanstalk:command"
    name      = "BatchSize"
    value     = "50"
  }
  setting {
    namespace = "aws:elasticbeanstalk:command"
    name      = "Timeout"
    value     = "600"
  }

  # ── Logging ────────────────────────────────────────────────────────────────
  setting {
    namespace = "aws:elasticbeanstalk:cloudwatch:logs"
    name      = "StreamLogs"
    value     = "false"
  }
  setting {
    namespace = "aws:elasticbeanstalk:cloudwatch:logs"
    name      = "RetentionInDays"
    value     = "7"
  }
  setting {
    namespace = "aws:elasticbeanstalk:cloudwatch:logs:health"
    name      = "HealthStreamingEnabled"
    value     = "false"
  }

  # ── Proxy ──────────────────────────────────────────────────────────────────
  setting {
    namespace = "aws:elasticbeanstalk:environment:proxy"
    name      = "ProxyServer"
    value     = "nginx"
  }

  # ── Managed platform updates — disabled (manual control) ──────────────────
  setting {
    namespace = "aws:elasticbeanstalk:managedactions"
    name      = "ManagedActionsEnabled"
    value     = "false"
  }

  # ── Notifications ──────────────────────────────────────────────────────────
  setting {
    namespace = "aws:elasticbeanstalk:sns:topics"
    name      = "Notification Endpoint"
    value     = var.notification_email
  }
  setting {
    namespace = "aws:elasticbeanstalk:sns:topics"
    name      = "Notification Protocol"
    value     = "email"
  }

  # ── App environment variables ──────────────────────────────────────────────
  dynamic "setting" {
    for_each = var.app_env_vars
    content {
      namespace = "aws:elasticbeanstalk:application:environment"
      name      = setting.key
      value     = setting.value
    }
  }

  # Ignore platform patch updates (AWS bumps minor versions automatically)
  lifecycle {
    ignore_changes = [solution_stack_name]
  }
}
