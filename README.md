# Secure Static Website with AWS CDK (with AWS WAF)

This project deploys a static website using AWS CDK, hosted on S3 and distributed via CloudFront, with a custom domain managed by Route 53 and an ACM certificate for HTTPS. This version **includes AWS WAF** to enhance security.

## Architecture
- **Amazon S3**: Stores the static website content (HTML, CSS, JavaScript, images).
- **Amazon CloudFront**: Acts as a Content Delivery Network (CDN) to cache and serve website content globally, improving performance and reducing latency. It's configured with an Origin Access Identity (OAI) to restrict direct access to the S3 bucket.
- **AWS Certificate Manager (ACM)**: Provides an SSL/TLS certificate to enable HTTPS for the custom domain.
- **Amazon Route 53**: Manages the DNS for the custom domain, pointing it to the CloudFront distribution.
- **AWS WAF**: Provides a web application firewall to protect the CloudFront distribution against common web exploits and offers rate limiting to mitigate DDoS attacks.

## Security Enhancements with AWS WAF

This deployment includes AWS WAF (Web Application Firewall) associated with the CloudFront distribution, offering several security benefits:

- **Protection Against Common Web Exploits**: WAF can help filter out malicious traffic such as SQL injection and Cross-Site Scripting (XSS), although the risk for purely static sites is primarily related to any client-side scripts interacting with external services.
- **Rate Limiting**: A rate-based rule is configured to block IP addresses that exceed a certain number of requests within a 5-minute period. This helps protect against HTTP flood DDoS attacks and abusive bot activity. The default rate limit is set to 500 requests per 5 minutes per IP, but this can be customized.
- **Managed Rule Sets (Optional)**: While not included by default in this basic setup, AWS WAF allows for the addition of AWS Managed Rule Groups (e.g., for Amazon IP reputation, known bad inputs) and custom rules to further enhance protection.

**Mitigations Already in Place (Complementary to WAF):**
- **Origin Access Identity (OAI)**: CloudFront uses an OAI to access the S3 bucket, preventing direct public S3 bucket access.
- **AWS Shield Standard**: Provides baseline protection against common network and transport layer DDoS attacks.

**Recommendations for Ongoing Security Management:**
1.  **AWS Budgets**: Configure AWS Budgets to alert you when your costs exceed predefined thresholds. This provides early notification of unusual spending, which could be an indicator of an attack.
2.  **CloudWatch Alarms**:
    - Monitor key CloudFront metrics: `Requests`, `BytesDownloaded`, `4xxErrorRate`, `5xxErrorRate`.
    - Monitor WAF metrics: `BlockedRequests` for the rate-based rule and the WebACL itself.
3.  **Regularly Review Logs**:
    - Enable and periodically review CloudFront access logs (consider using Amazon Athena for querying).
    - Enable and review WAF logs to understand blocked traffic and refine rules if necessary.
4.  **CloudFront Geo-restrictions**: If your website targets a specific geographic audience, consider using CloudFront geo-restrictions in addition to WAF rules.
5.  **Implement Strong Cache-Control Headers**: Maximize caching to reduce origin load and improve performance.

## Deployment

**Configuration:**

The stack's behavior is primarily configured through properties in `bin/app.ts` and CDK context values (either in `cdk.json` or via CLI flags).

1.  **Domain and Subdomain (in `bin/app.ts`):**
    Open `bin/app.ts` and set:
    - `domainName`: Your registered domain name (e.g., `example.com`). This is used for creating resource names, the S3 bucket, the ACM certificate, and as a fallback for the Route 53 zone name.
    - `siteSubDomain`: Your desired subdomain (e.g., `www`).
    - `wafRateLimit` (Optional): The maximum number of requests allowed from a single IP address within a 5-minute period before that IP is blocked. If not specified, it defaults to `500`. In the provided `bin/app.ts`, this is set to `1000`. You can adjust this value based on your expected traffic patterns.

2.  **Route 53 Hosted Zone (via CDK Context):**
    The `hostedZoneId` and `zoneName` for Route 53 are configured via CDK context. This is ideal for CI/CD.
    - **`hostedZoneId`**: The ID of your public hosted zone in Route 53 (e.g., `Z0123456789ABCDEFGHIJ`).
    - **`zoneName`**: The domain name of your hosted zone (e.g., `example.com`).

    You can set these in `cdk.json` under the `context` key:
    ```json
    // cdk.json
    {
      "app": "...",
      "context": {
        // ... other context variables
        "hostedZoneId": "YOUR_HOSTED_ZONE_ID_HERE",
        "zoneName": "your.domain.com"
      }
    }
    ```
    Alternatively, pass them via CLI flags (these override `cdk.json` values):
    ```bash
    cdk deploy --context hostedZoneId=YOUR_HOSTED_ZONE_ID --context zoneName=YOUR_ZONE_NAME
    ```
    If not provided, the stack uses fallback placeholders defined in `lib/static-site-stack.ts` (`Z0123456789ABCDEFGHIJ` for `hostedZoneId` and `props.domainName` for `zoneName`). **Providing your actual `hostedZoneId` is crucial for successful deployment.**

3.  **AWS Account and Region (in `bin/app.ts`):**
    Configure the target AWS account and region in `bin/app.ts`:
    ```typescript
    // bin/app.ts
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT || 'YOUR_ACCOUNT_ID', // Or your specific account
      region: process.env.CDK_DEFAULT_REGION || 'YOUR_REGION',   // Or your specific region
    },
    ```

**Deployment Commands:**
```bash
# Install dependencies
npm install

# Bootstrap AWS environment (once per account/region)
# Ensure us-east-1 is also bootstrapped if deploying the certificate there and it's different from your main stack region.
npx cdk bootstrap aws://ACCOUNT-ID/REGION # Replace ACCOUNT-ID and REGION

# Synthesize (optional, deploy does it too)
# Values from cdk.json are used by default if not overridden by --context
npx cdk synth 
# Or with CLI context:
# npx cdk synth --context hostedZoneId=YOUR_HOSTED_ZONE_ID --context zoneName=YOUR_ZONE_NAME

# Deploy the stack
# Values from cdk.json are used by default if not overridden by --context
npx cdk deploy
# Or with CLI context:
# npx cdk deploy --context hostedZoneId=YOUR_HOSTED_ZONE_ID --context zoneName=YOUR_ZONE_NAME
```

**Important Notes:**
- The ACM certificate for CloudFront must be in `us-east-1`. The stack handles this.
- Ensure your domain's NS records at your registrar point to the Route 53 name servers for the specified hosted zone.
- DNS validation for ACM will attempt to create CNAME records in your Route 53 hosted zone.

## CI/CD Pipeline for Content Updates

Automating the deployment of your website content (HTML, CSS, JS, images) is highly recommended. Here's a typical workflow:

1.  **Trigger**:
    - A code push to a specific branch (e.g., `main`, `master`, or `prod`) in your Git repository (e.g., GitHub, AWS CodeCommit, GitLab).

2.  **Build (Optional)**:
    - If you're using a static site generator (SSG) like Hugo, Jekyll, Next.js (static export), Gatsby, etc., this step involves running the build command (e.g., `npm run build`, `hugo`) to compile your site into static files (typically in a `public/`, `dist/`, or `_site/` folder).
    - For plain HTML/CSS/JS sites, this step might include linting, minification, or other asset optimization.

3.  **Deploy to S3**:
    - Synchronize your static files to the S3 website bucket. The bucket name is derived from `siteSubDomain` and `domainName` (e.g., `www.your.domain.com`).
    - Use the AWS CLI `s3 sync` command. The `--delete` flag is crucial as it removes files from S3 that are no longer in your source folder, ensuring a clean deployment.
      ```bash
      aws s3 sync ./site/ s3://your-bucket-name --delete
      # Replace your-bucket-name with the S3 bucket name (e.g., www.example.com).
      # This command syncs the content of your local 'site/' directory to the S3 bucket.
      ```

4.  **CloudFront Invalidation**:
    - After successfully syncing files to S3, you need to tell CloudFront to fetch the updated content from the origin (S3). This is done by creating an invalidation.
    - The CloudFront Distribution ID is an output of the `cdk deploy` command (or can be found in the AWS Console).
      ```bash
      aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths "/*"
      # Replace YOUR_DISTRIBUTION_ID with your actual CloudFront distribution ID.
      ```

**Cache-Busting Filenames:**

- **Technique**: This involves embedding a hash of the file's content into its name (e.g., `main.a1b2c3d4.css`, `bundle.x7y8z9w0.js`). When a file's content changes, its name (and hash) changes.
- **Benefits**:
    - Users receive the latest versions immediately because their browsers will request a new file (due to the changed name).
    - Avoids reliance on CloudFront cache expiry or waiting for invalidation propagation.
    - Allows for very long cache times (e.g., `Cache-Control: public, max-age=31536000, immutable`) for versioned assets, improving performance.
    - Your main `index.html` file should have a short cache time or `Cache-Control: no-cache` to ensure it always references the latest hashed assets.
- **Implementation**: Most modern static site generators and build tools (like Webpack, Rollup, Parcel) handle this automatically.

**Role of CloudFront Invalidations:**

- **Purpose**: Invalidations instruct CloudFront to mark cached objects at its edge locations as "expired." The next time a user requests an invalidated object, CloudFront fetches the latest version from the S3 origin.
- **`/*` Invalidation**: Invalidating all paths with `/*` is a blanket approach. It's simple but can be costly if you have many objects and update frequently, as AWS charges for invalidation paths (though there's a monthly free tier).
- **Specific Path Invalidations**: If you know which files have changed, you can invalidate only those specific paths (e.g., `/css/style.css`, `/js/main.js`). This is more cost-effective.
- **Propagation Delay**: Even after an invalidation is created, it takes some time (typically a few minutes) for it to propagate across all CloudFront edge locations. Cache-busting filenames are a more robust solution for immediate updates.

**Automation Tools:**

This entire CI/CD pipeline can be automated using services like:
- **GitHub Actions**
- **AWS CodePipeline** (integrates well with AWS CodeCommit, CodeBuild, S3, etc.)
- **GitLab CI/CD**
- **Jenkins**, and others.

These tools can listen for Git pushes, run build commands, execute S3 sync, and trigger CloudFront invalidations automatically.

## Testing AWS WAF Rate-Based Rule

This section explains how to test the AWS WAF rate-based rule functionality.

The WAF is configured with a rate-based rule. By default, this is set in `lib/static-site-stack.ts` to 500 requests per 5-minute period per IP, but it's overridden in `bin/app.ts` to 1000 requests. Adjust this value in `bin/app.ts` (`wafRateLimit`) as needed for your expected traffic.

**Prerequisites for testing:**

*   The CDK stack must be successfully deployed.
*   You need the website URL (either the CloudFront distribution URL like `d123example.cloudfront.net` or your configured custom domain like `www.example.com`).

**Testing Steps (General Guidance):**

You can test the rate-limiting by simulating a high volume of requests from a single IP address. Tools like Apache Bench (`ab`), `curl` in a loop, or simple scripts can be used for this.

Example using `curl` (run from a Linux/macOS terminal):
```bash
# Replace YOUR_WEBSITE_URL with your actual site URL (e.g., https://www.example.com or https://d123example.cloudfront.net)
# This sends 1200 requests. Adjust count based on your wafRateLimit (e.g., if 1000, send ~1100-1200).
for i in {1..1200}; do curl -s -o /dev/null -w "%{http_code}\n" YOUR_WEBSITE_URL; sleep 0.1; done
```

**Expected Outcome:**

*   Initially, you should see `200` (OK) responses.
*   After exceeding the rate limit (e.g., 1000 requests within 5 minutes for the default configuration in `bin/app.ts`), you should start seeing `403` (Forbidden) responses from CloudFront. This indicates that AWS WAF has blocked the requests from your IP.
*   The block will typically last for a few minutes for rate-based rules before the IP is automatically unblocked, unless further requests from the same IP keep it above the threshold.

**Verification in AWS Console:**

You can monitor WAF activity in the AWS Management Console:

1.  Navigate to the **WAF & Shield** console.
2.  In the navigation pane, under **AWS WAF**, choose **Web ACLs**.
3.  Select your Web ACL from the list (e.g., `SiteWebACL` or the name you configured).
4.  On the **Overview** tab, you can see graphs of allowed and blocked requests. Look for an increase in blocked requests by the rate-based rule.
5.  The **Sampled requests** tab can show details of requests that WAF has evaluated, including those that were blocked.
6.  Associated CloudWatch metrics for the Web ACL (e.g., `webACLMetric` and `RateLimitRuleMetric`) will also show allowed vs. blocked requests over time. You can find these in the CloudWatch console.

**Important Considerations:**

*   **Testing Costs**: Be mindful of any potential costs associated with CloudFront data transfer or WAF requests, though these should be minimal for this type of isolated test.
*   **Authorization**: Ensure you are only testing against your own resources and have proper authorization.
*   **Timing and Count**: The exact number of requests needed to trigger the block might vary slightly due to how WAF aggregates requests over its 5-minute evaluation period. Sending a burst slightly over the limit is a good way to test.
*   **IP Address**: Ensure the test traffic originates from a consistent public IP address that WAF can track. If you are behind a corporate NAT or VPN, all users sharing that egress IP will contribute to the same rate limit count.
