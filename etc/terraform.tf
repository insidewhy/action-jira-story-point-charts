locals {
  # amend these to match your specific configuration
  action_data_uploader_role_name = "github-action-data-bucket-uploader"
  github_repo                    = "project/repo"
  # S3 buckets must have names that are globally unique so choose something nobody else
  # in the world is using here and which should match the details configured in the workflow
  bucket_name = "my-bucket-name-github-action-data"
}

data "aws_caller_identity" "current" {}

# this identity provider allows github actions to assume roles
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = {
    Name = "github openid connect provider"
  }
}

# allow SSO users with permission set of "user" to assume the role necessary to read
# this bucket data
data "aws_iam_policy_document" "allow_sso_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:PrincipalArn"
      values = [
        "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/aws-reserved/sso.amazonaws.com/*/AWSReservedSSO_user_*"
      ]
    }
  }
}

data "aws_iam_policy_document" "main" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${local.github_repo}:*"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "action_data_uploader_assume" {
  override_policy_documents = [
    data.aws_iam_policy_document.allow_sso_assume.json,
    data.aws_iam_policy_document.main.json
  ]
}

resource "aws_iam_role" "action_data_bucket_uploader" {
  name               = local.action_data_uploader_role_name
  assume_role_policy = data.aws_iam_policy_document.action_data_uploader_assume.json

  tags = { Name = "github action data uploader role" }
}

resource "aws_s3_bucket" "action_data" {
  bucket        = local.bucket_name
  force_destroy = true

  tags = { Name = "github action data bucket" }
}

resource "aws_s3_bucket_ownership_controls" "action_data" {
  bucket = aws_s3_bucket.action_data.id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

locals {
  bucket_id  = aws_s3_bucket.action_data.id
  bucket_arn = aws_s3_bucket.action_data.arn
}

data "aws_iam_policy_document" "action_data_bucket" {
  statement {
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${local.bucket_arn}/**"]

    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.action_data_bucket_uploader.arn]
    }
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [local.bucket_arn]

    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.action_data_bucket_uploader.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "action_data_bucket" {
  bucket = local.bucket_id
  policy = data.aws_iam_policy_document.action_data_bucket.json
}
