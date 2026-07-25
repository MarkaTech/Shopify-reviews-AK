#!/usr/bin/env python3
"""Shopify Review App — Azure Deployment Guide (PDF)"""

import os, hashlib
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame
from reportlab.lib.colors import Color
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

# Fonts
FONT_DIR = '/usr/share/fonts'
pdfmetrics.registerFont(TTFont('NotoSerifSC', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC-Bold', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
pdfmetrics.registerFont(TTFont('Inter', f'{FONT_DIR}/truetype/english/Carlito-Regular.ttf'))
pdfmetrics.registerFont(TTFont('Inter-Bold', f'{FONT_DIR}/truetype/english/Carlito-Bold.ttf'))
registerFontFamily('NotoSerifSC', normal='NotoSerifSC', bold='NotoSerifSC-Bold')
registerFontFamily('Inter', normal='Inter', bold='Inter-Bold')

# Palette
PAGE_BG       = colors.HexColor('#f1f1f0')
TABLE_STRIPE  = colors.HexColor('#efeeeb')
HEADER_FILL   = colors.HexColor('#6e664e')
BORDER        = colors.HexColor('#c0baa9')
TEXT_PRIMARY   = colors.HexColor('#1f1e1c')
TEXT_MUTED     = colors.HexColor('#87847d')
SEM_SUCCESS   = colors.HexColor('#448b5c')
SEM_WARNING   = colors.HexColor('#b38e46')
SEM_ERROR     = colors.HexColor('#8f4640')
SEM_INFO      = colors.HexColor('#4876a3')

W, H = A4
MARGIN = 50

# Styles
style_h1 = ParagraphStyle('H1', fontName='Inter-Bold', fontSize=22, leading=28,
    spaceAfter=12, spaceBefore=24, textColor=TEXT_PRIMARY)
style_h2 = ParagraphStyle('H2', fontName='Inter-Bold', fontSize=16, leading=22,
    spaceAfter=8, spaceBefore=18, textColor=HEADER_FILL)
style_body = ParagraphStyle('Body', fontName='Inter', fontSize=10, leading=16,
    spaceAfter=8, textColor=TEXT_PRIMARY, alignment=TA_JUSTIFY)
style_body_sm = ParagraphStyle('BodySm', fontName='Inter', fontSize=9, leading=14,
    spaceAfter=6, textColor=TEXT_PRIMARY, alignment=TA_JUSTIFY)
style_code = ParagraphStyle('Code', fontName='NotoSerifSC', fontSize=8.5, leading=13,
    spaceAfter=4, spaceBefore=4, textColor=colors.HexColor('#2d2d2d'),
    backColor=colors.HexColor('#f5f3ef'), leftIndent=12, rightIndent=12,
    borderWidth=0.5, borderColor=BORDER, borderPadding=6)
style_note = ParagraphStyle('Note', fontName='Inter', fontSize=9, leading=14,
    spaceAfter=8, spaceBefore=4, textColor=SEM_INFO,
    leftIndent=16, borderWidth=2, borderColor=SEM_INFO, borderPadding=8)
style_warning = ParagraphStyle('Warning', fontName='Inter', fontSize=9, leading=14,
    spaceAfter=8, spaceBefore=4, textColor=SEM_ERROR,
    leftIndent=16, borderWidth=2, borderColor=SEM_ERROR, borderPadding=8)
style_success = ParagraphStyle('Success', fontName='Inter', fontSize=9, leading=14,
    spaceAfter=8, spaceBefore=4, textColor=SEM_SUCCESS,
    leftIndent=16, borderWidth=2, borderColor=SEM_SUCCESS, borderPadding=8)
style_bullet = ParagraphStyle('Bullet', fontName='Inter', fontSize=10, leading=15,
    spaceAfter=4, textColor=TEXT_PRIMARY, leftIndent=24, bulletIndent=12)
style_table_header = ParagraphStyle('TH', fontName='Inter-Bold', fontSize=9, leading=12,
    textColor=colors.white)
style_table_cell = ParagraphStyle('TC', fontName='Inter', fontSize=9, leading=13,
    textColor=TEXT_PRIMARY)
style_toc0 = ParagraphStyle('TOC0', fontName='Inter-Bold', fontSize=12, leading=20, leftIndent=0)
style_toc1 = ParagraphStyle('TOC1', fontName='Inter', fontSize=10, leading=18, leftIndent=20)

def on_page(canvas, doc):
    page_num = canvas.getPageNumber()
    canvas.saveState()
    if page_num == 1:
        canvas.setFillColor(HEADER_FILL)
        canvas.rect(0, 0, W, H, fill=1, stroke=0)
        canvas.setStrokeColor(colors.white)
        canvas.setLineWidth(4)
        canvas.line(0.12*W, 0.1*H, 0.12*W, 0.9*H)
    else:
        canvas.setFont('Inter', 8)
        canvas.setFillColor(TEXT_MUTED)
        label = "Page " + str(page_num - 2)
        canvas.drawCentredString(W / 2, 25, label)
    canvas.restoreState()

class TocDocTemplate(BaseDocTemplate):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        frame = Frame(self.leftMargin, self.bottomMargin,
                      self.width, self.height, id='normal')
        template = PageTemplate(id='main', frames=[frame], onPage=on_page)
        self.addPageTemplates([template])

    def afterFlowable(self, flowable):
        if hasattr(flowable, 'bookmark_name'):
            level = getattr(flowable, 'bookmark_level', 0)
            text = getattr(flowable, 'bookmark_text', '')
            key = getattr(flowable, 'bookmark_key', '')
            self.notify('TOCEntry', (level, text, self.page, key))

def add_heading(text, style, level=0):
    key = 'h_' + hashlib.md5(text.encode()).hexdigest()[:8]
    p = Paragraph('<a name="' + key + '"/>' + text, style)
    p.bookmark_name = key
    p.bookmark_level = level
    p.bookmark_text = text
    p.bookmark_key = key
    return p

def code_block(text):
    safe = text.replace('<', '&lt;').replace('>', '&gt;').replace('\n', '<br/>')
    return Paragraph(safe, style_code)

def step_table(steps):
    data = [[Paragraph('<b>Step</b>', style_table_header),
             Paragraph('<b>Action</b>', style_table_header),
             Paragraph('<b>Details</b>', style_table_header)]]
    for num, title, desc in steps:
        data.append([
            Paragraph('<b>' + str(num) + '</b>', style_table_cell),
            Paragraph(title, style_table_cell),
            Paragraph(desc, style_table_cell)
        ])
    col_w = [0.08*W, 0.27*W, 0.57*W]
    t = Table(data, colWidths=col_w, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), HEADER_FILL),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('GRID', (0,0), (-1,-1), 0.5, BORDER),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, TABLE_STRIPE]),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ]))
    return t

def info_table(rows):
    data = [[Paragraph('<b>Setting</b>', style_table_header),
             Paragraph('<b>Value</b>', style_table_header)]]
    for k, v in rows:
        data.append([Paragraph(k, style_table_cell), Paragraph(v, style_table_cell)])
    col_w = [0.35*W, 0.57*W]
    t = Table(data, colWidths=col_w, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), HEADER_FILL),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('GRID', (0,0), (-1,-1), 0.5, BORDER),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, TABLE_STRIPE]),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
    ]))
    return t

# Build PDF
OUTPUT_PATH = '/home/z/my-project/download/Shopify_Review_App_Azure_Deployment_Guide.pdf'
os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

doc = TocDocTemplate(OUTPUT_PATH, pagesize=A4,
    leftMargin=MARGIN, rightMargin=MARGIN,
    topMargin=MARGIN, bottomMargin=MARGIN,
    title='Shopify Review App - Azure Deployment Guide',
    author='ReviewMaster',
    subject='Step-by-step guide for deploying a Shopify Review App on Microsoft Azure')

story = []

# COVER PAGE
story.append(Spacer(1, H * 0.22))
story.append(Paragraph('DEPLOYMENT GUIDE',
    ParagraphStyle('CoverKicker', fontName='Inter', fontSize=14, leading=16,
        textColor=Color(1,1,1,0.6))))
story.append(Spacer(1, H * 0.08))
story.append(Paragraph('<b>ReviewMaster</b>',
    ParagraphStyle('CoverTitle', fontName='Inter-Bold', fontSize=42, leading=50,
        textColor=colors.white, leftIndent=MARGIN + 30)))
story.append(Spacer(1, H * 0.04))
story.append(Paragraph('Shopify Review App',
    ParagraphStyle('CoverSub', fontName='Inter', fontSize=20, leading=26,
        textColor=Color(1,1,1,0.85), leftIndent=MARGIN + 30)))
story.append(Spacer(1, H * 0.06))
story.append(Paragraph(
    'Complete step-by-step guide for hosting your Shopify Review App on Microsoft Azure, '
    'configuring PostgreSQL, setting up CI/CD with GitHub Actions, and publishing on the Shopify App Store.',
    ParagraphStyle('CoverSummary', fontName='Inter', fontSize=11, leading=18,
        textColor=Color(1,1,1,0.8), leftIndent=MARGIN + 30, rightIndent=W*0.3)))
story.append(Spacer(1, H * 0.12))
story.append(Paragraph('July 2026  |  Version 1.0',
    ParagraphStyle('CoverDate', fontName='Inter', fontSize=12, leading=14,
        textColor=Color(1,1,1,0.5), leftIndent=MARGIN + 30)))
story.append(PageBreak())

# TOC
story.append(Paragraph('<b>Table of Contents</b>', style_h1))
toc = TableOfContents()
toc.levelStyles = [style_toc0, style_toc1]
story.append(toc)
story.append(PageBreak())

# CHAPTER 1: Prerequisites
story.append(add_heading('1. Prerequisites and Accounts Setup', style_h1, 0))
story.append(Paragraph(
    'Before deploying your Shopify Review App to Azure and publishing it on the Shopify App Store, '
    'you need to set up several accounts and install the required development tools. This chapter '
    'covers everything you need to have in place before writing a single deployment command. '
    'Each prerequisite is critical for the deployment pipeline to function correctly, and skipping '
    'any step will cause failures downstream in the process.', style_body))

story.append(add_heading('1.1 Required Accounts', style_h2, 1))
story.append(Paragraph(
    'You will need accounts across multiple platforms to complete the full deployment and publishing '
    'pipeline. Each account serves a specific purpose in the infrastructure chain, from code hosting '
    'to cloud deployment to the Shopify marketplace. Below is the complete list of required accounts '
    'with links to their signup pages and notes on what you will use each one for.', style_body))

story.append(info_table([
    ('Azure Account', 'https://azure.microsoft.com/free/ - Free tier includes $200 credit for 30 days, plus 12 months of popular free services.'),
    ('GitHub Account', 'https://github.com - Required for source code hosting and GitHub Actions CI/CD pipeline. Free tier supports unlimited public repos.'),
    ('Shopify Partner Account', 'https://partners.shopify.com - You already have this. Used for creating the app listing, managing API credentials, and accessing the Partner Dashboard.'),
    ('Docker Hub (optional)', 'https://hub.docker.com - Optional for public container images. GitHub Container Registry (ghcr.io) is used by default.'),
    ('Domain Name (recommended)', 'A custom domain for your app (e.g., app.reviewmaster.com). You can use Azure *.azurewebsites.net domain during testing.'),
]))

story.append(add_heading('1.2 Required CLI Tools', style_h2, 1))
story.append(Paragraph(
    'The following command-line tools must be installed on your local development machine. These tools '
    'enable you to interact with Azure services, build Docker containers, manage Git repositories, and '
    'execute database migrations.', style_body))

story.append(step_table([
    ('1', 'Azure CLI', 'brew install azure-cli / curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash. Verify with: az --version'),
    ('2', 'Docker Desktop', 'https://www.docker.com/products/docker-desktop. Required for building and testing containers locally.'),
    ('3', 'Git', 'brew install git / sudo apt install git. Verify with: git --version'),
    ('4', 'Node.js 20+', 'brew install node@20 / nvm install 20. Required by the Next.js application runtime.'),
    ('5', 'Bun runtime', 'curl -fsSL https://bun.sh/install | bash. Used as the primary package manager in this project.'),
    ('6', 'Prisma CLI', 'npm install -g prisma or bun add -g prisma. Used for database migrations and schema management.'),
]))

story.append(add_heading('1.3 Project Files Already Prepared', style_h2, 1))
story.append(Paragraph(
    'The following files have been prepared in your project directory for production deployment. '
    'The Dockerfile uses a multi-stage build process for optimal image size and security.', style_body))

story.append(info_table([
    ('Dockerfile', 'Multi-stage build: base, deps, builder (Prisma generate + Next.js build), runner. Exposes port 8080. Health check included.'),
    ('.dockerignore', 'Excludes node_modules, .next, .git, .env, db/, scripts/, upload/, download/, tests/'),
    ('next.config.ts', 'output: "standalone" enabled, reactStrictMode: false for production.'),
    ('prisma/schema.prisma', 'Migrated from SQLite to PostgreSQL. 8 models with proper indexes.'),
    ('azure-deploy.yml', 'GitHub Actions CI/CD: builds Docker image, pushes to GHCR, deploys to Azure Web App.'),
]))

# CHAPTER 2: Azure Resources
story.append(add_heading('2. Create Azure Resources', style_h1, 0))
story.append(Paragraph(
    'Azure provides a comprehensive suite of cloud services ideal for hosting a Shopify application. '
    'This chapter walks you through creating each Azure resource using the Azure CLI. Every resource '
    'is created within a Resource Group, which acts as a logical container for all related services.', style_body))

story.append(add_heading('2.1 Create a Resource Group', style_h2, 1))
story.append(Paragraph(
    'A Resource Group is the foundational container in Azure. By placing all resources in one group, '
    'you can manage them collectively, apply tags for cost tracking, and delete everything in one operation. '
    'Choose a region closest to your target users for optimal latency. For Shopify apps, eastus or eastus2 '
    'provide excellent connectivity to both North American and global markets.', style_body))

story.append(code_block(
    '# Log in to Azure (opens browser for authentication)\n'
    'az login\n\n'
    '# Create a resource group\n'
    'az group create --name reviewmaster-rg --location eastus\n\n'
    '# Verify\n'
    'az group show --name reviewmaster-rg'))

story.append(add_heading('2.2 Create Azure PostgreSQL Database', style_h2, 1))
story.append(Paragraph(
    'Shopify apps serving multiple merchants require a production-grade database with concurrent connections, '
    'automatic backups, and high availability. Azure Database for PostgreSQL Flexible Server provides all of '
    'these features with burstable compute capabilities ideal for variable traffic patterns.', style_body))

story.append(code_block(
    '# Create PostgreSQL Flexible Server\n'
    'az postgres flexible-server create \\\n'
    '  --resource-group reviewmaster-rg \\\n'
    '  --name reviewmaster-db-server \\\n'
    '  --location eastus \\\n'
    '  --admin-user dbadmin \\\n'
    '  --admin-password "Your_Str0ng_P@ssw0rd!" \\\n'
    '  --sku-name Standard_B1ms \\\n'
    '  --tier Burstable \\\n'
    '  --storage-size 32 \\\n'
    '  --version 16\n\n'
    '# Configure firewall for Azure services\n'
    'az postgres flexible-server firewall-rule create \\\n'
    '  --resource-group reviewmaster-rg \\\n'
    '  --name reviewmaster-db-server \\\n'
    '  --rule-name AllowAzureServices \\\n'
    '  --start-ip-address 0.0.0.0 \\\n'
    '  --end-ip-address 0.0.0.0\n\n'
    '# Create the application database\n'
    'az postgres flexible-server db create \\\n'
    '  --resource-group reviewmaster-rg \\\n'
    '  --name reviewmaster-db-server \\\n'
    '  --database-name reviewmaster'))

story.append(Paragraph(
    '<b>Note:</b> The admin password must be at least 8 characters with three of: uppercase, lowercase, '
    'numbers, and special characters. Store this password securely in a password manager.', style_note))

story.append(add_heading('2.3 Create Azure Web App for Containers', style_h2, 1))
story.append(Paragraph(
    'Azure Web App for Containers is the primary compute resource that hosts your Next.js application. '
    'It provides managed container hosting with automatic scaling, SSL termination, and custom domain support.', style_body))

story.append(code_block(
    '# Create App Service Plan\n'
    'az appservice plan create \\\n'
    '  --resource-group reviewmaster-rg \\\n'
    '  --name reviewmaster-plan \\\n'
    '  --sku B1 --is-linux\n\n'
    '# Create Web App\n'
    'az webapp create \\\n'
    '  --resource-group reviewmaster-rg \\\n'
    '  --plan reviewmaster-plan \\\n'
    '  --name reviewmaster-app \\\n'
    '  --deployment-container-image-name nginx:latest\n\n'
    '# Configure GHCR container\n'
    'az webapp config container set \\\n'
    '  --resource-group reviewmaster-rg \\\n'
    '  --name reviewmaster-app \\\n'
    '  --docker-custom-image-name ghcr.io/YOUR_GITHUB_USERNAME/reviewmaster-app:latest \\\n'
    '  --docker-registry-server-url https://ghcr.io'))

story.append(add_heading('2.4 Configure Environment Variables', style_h2, 1))
story.append(Paragraph(
    'Environment variables are essential for runtime configuration without embedding secrets in the Docker image. '
    'Azure Web App supports application settings injected as environment variables into the container.', style_body))

story.append(code_block(
    '# Get PostgreSQL host\n'
    'POSTGRES_HOST=$(az postgres flexible-server show \\\n'
    '  --resource-group reviewmaster-rg \\\n'
    '  --name reviewmaster-db-server \\\n'
    '  --query "fullyQualifiedDomainName" -o tsv)\n\n'
    '# Set environment variables\n'
    'az webapp config appsettings set \\\n'
    '  --resource-group reviewmaster-rg \\\n'
    '  --name reviewmaster-app \\\n'
    '  --settings \\\n'
    '    NODE_ENV=production \\\n'
    '    DATABASE_URL="postgresql://dbadmin:Your_Pass@${POSTGRES_HOST}:5432/reviewmaster?sslmode=require" \\\n'
    '    NEXT_PUBLIC_SHOPIFY_API_KEY="your_shopify_api_key" \\\n'
    '    SHOPIFY_API_SECRET="your_shopify_api_secret" \\\n'
    '    SHOPIFY_APP_URL="https://reviewmaster-app.azurewebsites.net" \\\n'
    '    NEXTAUTH_SECRET="your_nextauth_secret_key_min_32_chars" \\\n'
    '    NEXTAUTH_URL="https://reviewmaster-app.azurewebsites.net/api/auth"'))

story.append(Paragraph(
    '<b>Important:</b> The NEXTAUTH_SECRET must be a random string of at least 32 characters. '
    'Generate one with: openssl rand -base64 32. Never commit secrets to Git.', style_warning))

# CHAPTER 3: Database Migration
story.append(add_heading('3. Database Migration: SQLite to PostgreSQL', style_h1, 0))
story.append(Paragraph(
    'Your local development uses SQLite, which is perfect for development but unsuitable for production multi-tenant '
    'applications. SQLite does not support concurrent writes from multiple instances, lacks built-in replication, '
    'and cannot scale horizontally. Azure requires a server-based database, and PostgreSQL is recommended for '
    'Next.js applications due to excellent Prisma ORM compatibility.', style_body))

story.append(add_heading('3.1 Why PostgreSQL Over SQLite', style_h2, 1))
story.append(info_table([
    ('Concurrent Connections', 'SQLite uses file-level locking, limiting writes to one at a time. PostgreSQL supports hundreds of concurrent connections.'),
    ('Scalability', 'SQLite is limited to one server. PostgreSQL scales vertically and horizontally with read replicas.'),
    ('Data Integrity', 'PostgreSQL offers advanced constraints, foreign keys with cascade actions, and transactional DDL.'),
    ('JSON Support', 'PostgreSQL has native JSONB with indexing and query operators, perfect for widget configs and custom fields.'),
    ('Azure Compatibility', 'Azure Managed PostgreSQL provides automated backups, point-in-time recovery, and high availability.'),
    ('Prisma Support', 'Prisma ORM has first-class PostgreSQL support with migrations, introspection, and all features fully supported.'),
]))

story.append(add_heading('3.2 Run Migrations on Azure', style_h2, 1))
story.append(Paragraph(
    'After deploying, create the database tables in the PostgreSQL database using Prisma migration commands. '
    'Use the local CLI method for initial setup, giving you full control and visibility.', style_body))

story.append(code_block(
    '# Generate Prisma client\n'
    'npx prisma generate\n\n'
    '# Set DATABASE_URL to Azure PostgreSQL\n'
    'export DATABASE_URL="postgresql://dbadmin:Your_Pass@reviewmaster-db-server.postgres.database.azure.com:5432/reviewmaster?sslmode=require"\n\n'
    '# Push schema to create tables\n'
    'npx prisma db push\n\n'
    '# For production, use migration files:\n'
    'npx prisma migrate dev --name init\n'
    'npx prisma migrate deploy'))

story.append(Paragraph(
    '<b>Production Best Practice:</b> Use "prisma migrate deploy" (not "prisma migrate dev") in production. '
    'The dev command creates new migrations, while deploy only applies existing ones.', style_success))

# CHAPTER 4: CI/CD
story.append(add_heading('4. GitHub Actions CI/CD Pipeline', style_h1, 0))
story.append(Paragraph(
    'Continuous Integration and Continuous Deployment automates building, testing, and deploying your application '
    'every time you push code to the main branch. The GitHub Actions workflow provided with your project handles '
    'the entire pipeline: checking out code, building the Docker image, pushing it to GitHub Container Registry, '
    'and deploying it to Azure Web App.', style_body))

story.append(add_heading('4.1 Push Code to GitHub', style_h2, 1))
story.append(code_block(
    'cd /path/to/your/project\n'
    'git init\n'
    'git add .\n'
    'git commit -m "Initial commit: Shopify Review App"\n'
    'git branch -M main\n'
    'git remote add origin https://github.com/YOUR_USERNAME/shopify-review-app.git\n'
    'git push -u origin main'))

story.append(add_heading('4.2 Configure GitHub Secrets', style_h2, 1))
story.append(Paragraph(
    'GitHub Actions needs credentials to deploy to Azure, stored as encrypted repository secrets.', style_body))

story.append(step_table([
    ('1', 'Create Service Principal', 'az ad sp create-for-rbac --name "reviewmaster-deploy" --role contributor --scopes /subscriptions/YOUR_SUB_ID --sdk-auth'),
    ('2', 'Add GitHub Secret', 'Go to repo Settings > Secrets > Actions > New secret. Name: AZURE_CREDENTIALS. Value: paste JSON from step 1.'),
    ('3', 'Verify Permissions', 'Settings > Actions > General > Workflow permissions: check "Read and write permissions".'),
    ('4', 'Trigger Pipeline', 'Push any commit to main. Monitor at github.com/YOUR_USER/shopify-review-app/actions.'),
]))

story.append(Paragraph(
    '<b>Security Note:</b> Never hardcode Azure credentials in code. The service principal should have minimum '
    'required permissions (Contributor role on the resource group is sufficient).', style_warning))

# CHAPTER 5: Shopify Config
story.append(add_heading('5. Shopify App Store Configuration', style_h1, 0))
story.append(Paragraph(
    'Before submitting your app to the Shopify App Store, configure it in the Shopify Partner Dashboard. '
    'This involves creating an app entry, setting up OAuth credentials, configuring redirect URLs, and '
    'enabling required API access scopes.', style_body))

story.append(add_heading('5.1 Required Shopify API Scopes', style_h2, 1))
story.append(Paragraph(
    'Shopify recommends requesting only the minimum scopes necessary. Excessive scope requests are a common '
    'reason for app rejection during review.', style_body))

story.append(info_table([
    ('read_products', 'Read product data to display names, images, and details in the review widget on the storefront.'),
    ('write_products', 'Add review badges and star ratings metadata to product pages via the Storefront API.'),
    ('read_orders', 'Access order data to send review request emails after order delivery.'),
    ('read_customers', 'Match reviewer profiles with customer accounts for verified purchase badges.'),
    ('read_script_tags', 'Inject the review widget JavaScript into the merchant storefront.'),
    ('write_script_tags', 'Manage script tags that render the review widget on product pages.'),
    ('read_themes', 'Read theme configuration to properly inject review widgets.'),
    ('write_themes', 'Create and modify theme sections and snippets for review widget integration.'),
]))

story.append(add_heading('5.2 Configure OAuth Redirect URLs', style_h2, 1))
story.append(Paragraph(
    'OAuth redirect URLs tell Shopify where to send the user after they approve your app installation. '
    'These URLs must use HTTPS and must exactly match your application callback URLs.', style_body))

story.append(code_block(
    '# Development redirect URL\n'
    'https://your-ngrok-url.ngrok.io/api/auth/callback/shopify\n\n'
    '# Production redirect URL (Azure)\n'
    'https://reviewmaster-app.azurewebsites.net/api/auth/callback/shopify\n\n'
    '# Custom domain (after configuration)\n'
    'https://app.reviewmaster.com/api/auth/callback/shopify'))

story.append(add_heading('5.3 API Credentials Reference', style_h2, 1))
story.append(info_table([
    ('NEXT_PUBLIC_SHOPIFY_API_KEY', 'Public client ID used in Shopify App Bridge initialization. Set in Partner Dashboard.'),
    ('SHOPIFY_API_SECRET', 'Secret client key for OAuth HMAC verification. NEVER expose in frontend code.'),
    ('SHOPIFY_APP_URL', 'Full HTTPS URL of your deployed app. Used for webhook registration and redirect URL validation.'),
    ('NEXTAUTH_SECRET', 'Random string (min 32 chars) for NextAuth.js session encryption. Generate: openssl rand -base64 32'),
    ('NEXTAUTH_URL', 'Base URL of auth endpoint: https://your-app-domain/api/auth'),
]))

# CHAPTER 6: Custom Domain
story.append(add_heading('6. Custom Domain and SSL Configuration', style_h1, 0))
story.append(Paragraph(
    'A custom domain is essential for a professional Shopify app. Azure provides free managed SSL certificates '
    'that automatically renew, eliminating manual certificate management.', style_body))

story.append(step_table([
    ('1', 'Purchase Domain', 'Buy from Namecheap, GoDaddy, or Cloudflare. Example: reviewmaster.com'),
    ('2', 'Create CNAME Record', 'In DNS panel: app.reviewmaster.com CNAME -> reviewmaster-app.azurewebsites.net'),
    ('3', 'Add Domain in Azure', 'Portal > Web App > Custom domains > Add: app.reviewmaster.com'),
    ('4', 'Verify Domain', 'Azure verifies CNAME record. Status changes from Pending to Verified.'),
    ('5', 'SSL Certificate', 'Select "Managed Certificate" for free auto-renewing SSL.'),
    ('6', 'Update Shopify Config', 'Update SHOPIFY_APP_URL and all redirect URLs to the new custom domain.'),
]))

# CHAPTER 7: App Store Submission
story.append(add_heading('7. Shopify App Store Submission Checklist', style_h1, 0))
story.append(Paragraph(
    'The Shopify App Store has rigorous review guidelines. The review process typically takes 3-10 business days. '
    'Address every item below to maximize your chances of approval on the first attempt.', style_body))

story.append(add_heading('7.1 Technical Requirements', style_h2, 1))
story.append(step_table([
    ('1', 'HTTPS Everywhere', 'All endpoints must use HTTPS. Azure provides free SSL.'),
    ('2', 'OAuth Implementation', 'Use Shopify OAuth. Never store raw access tokens.'),
    ('3', 'App Bridge Setup', 'Implement Shopify App Bridge in embedded dashboard.'),
    ('4', 'Error Handling', 'All API routes must return proper HTTP status codes.'),
    ('5', 'Rate Limiting', 'Respect Shopify API rate limits (2 req/sec per store).'),
    ('6', 'Webhook Verification', 'All webhook handlers must verify HMAC signature.'),
    ('7', 'Data Privacy', 'Comply with GDPR. Provide data deletion capabilities.'),
    ('8', 'Performance', 'App must load within 3 seconds.'),
    ('9', 'Mobile Responsive', 'Dashboard must work on mobile devices.'),
    ('10', 'Graceful Degradation', 'Handle Shopify API errors gracefully.'),
]))

story.append(add_heading('7.2 App Listing Requirements', style_h2, 1))
story.append(step_table([
    ('1', 'App Name and Icon', 'Unique name. 128x128px icon, PNG format, no transparency.'),
    ('2', 'Detailed Description', 'Minimum 200 words describing features and benefits.'),
    ('3', 'Screenshots (5+)', '1024x768px or 1280x800px. Show dashboard, import, widgets, settings, storefront.'),
    ('4', 'App URL', 'Your live, HTTPS-enabled application URL.'),
    ('5', 'Support URL', 'Support page URL or email address.'),
    ('6', 'Privacy Policy URL', 'Required. Must comply with Shopify data privacy requirements.'),
    ('7', 'Terms of Service URL', 'Required. Must cover usage rights and limitations.'),
]))

story.append(add_heading('7.3 Subscription Billing Setup', style_h2, 1))
story.append(info_table([
    ('Free Plan', '$0/month. Basic review collection, 50 reviews limit, 1 widget type, basic filters.'),
    ('Starter Plan', '$9.99/month. Up to 500 reviews, all widgets, CSV import, photo reviews, email requests.'),
    ('Pro Plan', '$29.99/month. Unlimited reviews, platform imports, advanced filters, analytics dashboard.'),
    ('Enterprise Plan', '$99.99/month. All Pro features plus API access, white-label widgets, dedicated support.'),
]))

# CHAPTER 8: Monitoring
story.append(add_heading('8. Post-Deployment and Monitoring', style_h1, 0))
story.append(Paragraph(
    'After deployment, ongoing monitoring is critical. Azure provides Application Insights, Log Analytics, '
    'and Azure Monitor for tracking performance, detecting errors, and optimizing resource usage.', style_body))

story.append(add_heading('8.1 Enable Application Insights', style_h2, 1))
story.append(code_block(
    '# Create Application Insights\n'
    'az monitor app-insights component create \\\n'
    '  --resource-group reviewmaster-rg \\\n'
    '  --app reviewmaster-insights \\\n'
    '  --location eastus\n\n'
    '# Get instrumentation key and add to Web App\n'
    'APPINSIGHTS_KEY=$(az monitor app-insights component show \\\n'
    '  --resource-group reviewmaster-rg \\\n'
    '  --app reviewmaster-insights \\\n'
    '  --query "instrumentationKey" -o tsv)\n\n'
    'az webapp config appsettings set \\\n'
    '  --resource-group reviewmaster-rg \\\n'
    '  --name reviewmaster-app \\\n'
    '  --settings APPLICATIONINSIGHTS_CONNECTION_STRING=$APPINSIGHTS_KEY'))

story.append(add_heading('8.2 Recommended Alerts', style_h2, 1))
story.append(step_table([
    ('1', 'HTTP 5xx Errors', 'Alert when error rate exceeds 5% over 5 minutes.'),
    ('2', 'Response Time', 'Alert when average response time exceeds 3 seconds.'),
    ('3', 'CPU Usage', 'Alert when CPU exceeds 80% for 15 minutes.'),
    ('4', 'Memory Usage', 'Alert when memory exceeds 85% for 15 minutes.'),
    ('5', 'DB Connections', 'Alert when active PostgreSQL connections exceed 80% of maximum.'),
]))

# CHAPTER 9: Cost
story.append(add_heading('9. Cost Estimate', style_h1, 0))
story.append(Paragraph(
    'Understanding costs is essential for pricing your subscription plans appropriately. The estimates below '
    'are based on Azure East US pricing as of 2025.', style_body))

story.append(info_table([
    ('Azure Web App (B1 Basic)', '$13.40/month. 1 vCore, 1.75GB RAM, 10GB disk.'),
    ('Azure PostgreSQL (B1ms Burstable)', '$14.70/month. 1 vCore, 2GB RAM, 32GB storage.'),
    ('Application Insights', '$0/month for basic tier.'),
    ('GitHub Container Registry', '$0/month for public repos.'),
    ('Azure Bandwidth', '$0.087/GB outbound. First 100GB inbound free.'),
    ('Domain (annual)', '$10-15/year for registration.'),
]))

story.append(Paragraph(
    '<b>Total Estimated Monthly Cost: $28-45/month</b> during initial launch. Costs scale linearly with '
    'traffic. The B1 tier supports up to ~10,000 requests/minute. At 1,000+ merchants, consider '
    'P1v3 Premium tier at $150/month for dedicated resources.', style_body))

story.append(Spacer(1, 12))
story.append(HRFlowable(width="100%", thickness=1, color=BORDER))
story.append(Spacer(1, 8))
story.append(Paragraph(
    '<b>Next Steps:</b> After completing Azure deployment, test your app on a Shopify development store '
    'by installing it through the Partner Dashboard. Verify OAuth flow, dashboard functionality, and '
    'API routes. Once testing is complete, submit the app listing for Shopify App Store review '
    '(3-10 business days for first submissions).', style_body))

# Build
doc.multiBuild(story)
print('PDF generated at: ' + OUTPUT_PATH)
