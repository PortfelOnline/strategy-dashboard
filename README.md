# AI Consultant India Strategy Dashboard

A comprehensive content generation and management system for **get-my-agent.com** targeting the Indian market. This platform enables AI-powered content creation, management, and direct publishing to Facebook and Instagram.

## 🎯 Overview

This dashboard provides a complete solution for social media marketing strategy in India with:
- **AI-powered content generation** using LLM integration
- **Multi-platform support** (Facebook, Instagram, WhatsApp)
- **Meta API integration** for direct posting
- **Content management system** with draft/publish workflow
- **Market analytics** and demographic insights

## 🚀 Features

### Content Generation
- **3 Viral Content Pillars**:
  1. **Relatable Desi Business Owner** - Humor-based content showing customer service struggles
  2. **5-Minute Transformation** - Fast-paced setup demonstrations
  3. **ROI Calculator** - Financial benefits comparison

- **Multi-language Support**: Hinglish, Hindi, English, Tamil, Telugu, Bengali
- **Platform-specific Optimization**: Facebook, Instagram, WhatsApp
- **AI-powered Suggestions**: Automatic hashtag and caption generation

### Content Management
- **Content Library**: Organize posts by status (draft, scheduled, published, archived)
- **Search & Filter**: Find content by title, platform, language
- **Bulk Operations**: Manage multiple posts efficiently
- **Status Tracking**: Monitor post lifecycle

### Meta API Integration
- **OAuth 2.0 Authentication**: Secure account linking
- **Direct Publishing**: One-click posting to Facebook and Instagram
- **Account Management**: Connect/disconnect multiple accounts
- **Error Handling**: Robust error management and user feedback

### Analytics & Insights
- **Market Overview**: 491M users, 6.3% growth, 2h 28m daily usage
- **Demographics**: Age distribution, gender breakdown, platform statistics
- **Platform Comparison**: User reach and advertising effectiveness
- **Key Insights**: Target audience, language strategy, pricing messaging

## 🛠️ Tech Stack

### Frontend
- **React 19** with TypeScript
- **Tailwind CSS 4** for styling
- **Recharts** for data visualization
- **shadcn/ui** for components
- **tRPC** for type-safe API calls

### Backend
- **Express 4** server
- **tRPC 11** for API procedures
- **Drizzle ORM** for database management
- **MySQL** database
- **LLM Integration** for AI content generation

### Infrastructure
- **Vite** for build tooling
- **Vitest** for testing
- **GitHub** for version control
- **S3** for file storage

## 📋 Project Structure

```
strategy-dashboard/
├── client/                          # Frontend React application
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.tsx            # Dashboard homepage with insights
│   │   │   ├── ContentGenerator.tsx # AI content generation interface
│   │   │   ├── ContentLibrary.tsx   # Content management library
│   │   │   └── MetaAccounts.tsx     # Meta account management
│   │   ├── components/
│   │   │   ├── PublishToMeta.tsx    # Publishing dialog component
│   │   │   ├── DashboardLayout.tsx  # Main layout wrapper
│   │   │   └── AIChatBox.tsx        # Chat interface
│   │   ├── lib/
│   │   │   └── trpc.ts             # tRPC client configuration
│   │   └── App.tsx                  # Main app component
│   └── public/
│       └── images/                  # Static assets
├── server/                          # Backend Node.js application
│   ├── routers.ts                   # Main tRPC router
│   ├── routers/
│   │   └── meta.ts                  # Meta API procedures
│   ├── db.ts                        # Database helpers
│   ├── meta.db.ts                   # Meta account database operations
│   ├── _core/
│   │   ├── meta.ts                  # Meta API integration service
│   │   ├── llm.ts                   # LLM integration
│   │   ├── trpc.ts                  # tRPC setup
│   │   └── context.ts               # Request context
│   └── content.test.ts              # Content generation tests
├── drizzle/                         # Database schema
│   ├── schema.ts                    # Table definitions
│   └── migrations/                  # Database migrations
├── shared/                          # Shared types and constants
│   ├── const.ts                     # Constants
│   └── types.ts                     # Shared types
└── package.json                     # Dependencies

```

## 🔧 Setup & Installation

### Prerequisites
- Node.js 22.13.0+
- pnpm 10.4.1+
- MySQL database
- Meta App credentials (App ID, App Secret)

### Environment Variables

Create `.env` file with:
```env
# Database
DATABASE_URL=mysql://user:password@localhost:3306/strategy_dashboard

# Meta API
META_APP_ID=your_app_id
META_APP_SECRET=your_app_secret
META_REDIRECT_URI=http://localhost:3000/api/oauth/callback

# Authentication
JWT_SECRET=your_jwt_secret
VITE_APP_ID=your_manus_app_id
OAUTH_SERVER_URL=https://api.manus.im

# LLM
BUILT_IN_FORGE_API_URL=https://api.manus.im
BUILT_IN_FORGE_API_KEY=your_api_key
```

### Installation Steps

```bash
# Install dependencies
pnpm install

# Setup database
pnpm db:push

# Start development server
pnpm dev

# Run tests
pnpm test

# Build for production
pnpm build
```

## 📱 Usage Guide

### 1. Generate Content
1. Navigate to **Generate Content** page
2. Select content pillar (Desi Business Owner, 5-Minute Transformation, ROI Calculator)
3. Choose platform (Facebook, Instagram, WhatsApp)
4. Select language (Hinglish, Hindi, English, etc.)
5. Click "Generate" to create AI content
6. Review and save as draft

### 2. Manage Content
1. Go to **Content Library**
2. Filter by status (draft, scheduled, published)
3. Search for specific content
4. Edit, delete, or publish posts

### 3. Connect Meta Accounts
1. Navigate to **Connected Accounts**
2. Click "Connect Meta Account"
3. Authorize via Meta OAuth
4. Select account type (Instagram Business or Facebook Page)
5. Account is now ready for publishing

### 4. Publish to Social Media
1. In Content Library, find draft post
2. Click "Publish" button
3. Select connected account
4. Confirm and publish
5. Post goes live on selected platform

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test server/content.test.ts

# Run tests in watch mode
pnpm test --watch
```

### Test Coverage
- Content generation with LLM
- Post creation and retrieval
- Template management
- Meta API operations
- Database operations

## 📊 API Endpoints

### Content Management
- `POST /api/trpc/content.generatePost` - Generate AI content
- `POST /api/trpc/content.savePost` - Save post to library
- `GET /api/trpc/content.listPosts` - List posts by status
- `GET /api/trpc/content.getPost` - Get specific post
- `DELETE /api/trpc/content.deletePost` - Delete post

### Meta API
- `GET /api/trpc/meta.getOAuthUrl` - Get OAuth authorization URL
- `POST /api/trpc/meta.handleOAuthCallback` - Handle OAuth callback
- `GET /api/trpc/meta.getAccounts` - List connected accounts
- `POST /api/trpc/meta.publishToInstagram` - Publish to Instagram
- `POST /api/trpc/meta.publishToFacebook` - Publish to Facebook
- `DELETE /api/trpc/meta.disconnectAccount` - Disconnect account

## 🔐 Security

- **OAuth 2.0**: Secure Meta account authentication
- **JWT Tokens**: Session management
- **Environment Variables**: Sensitive data protection
- **HTTPS**: Encrypted communication
- **Database**: Secure credential storage

## 📈 Performance Metrics

- **Market Size**: 491M social media users in India
- **Growth Rate**: 6.3% annually (29M new users)
- **Daily Usage**: 2h 28m average per user
- **Target Demographic**: 65.5% male, primarily aged 25-44
- **Platform Reach**: Facebook (48.8%), Instagram (25.3%), WhatsApp (83.0%)

## 🚀 Deployment

### Production Build
```bash
pnpm build
pnpm start
```

### Environment Setup
- Set all required environment variables
- Configure database connection
- Enable HTTPS
- Setup Meta App webhooks
- Configure analytics tracking

## 📝 Database Schema

### Tables
- **users**: User accounts and authentication
- **contentPosts**: Generated content posts
- **contentTemplates**: Reusable content templates
- **metaAccounts**: Connected Meta/Facebook accounts

## 🤝 Contributing

1. Create feature branch: `git checkout -b feature/your-feature`
2. Commit changes: `git commit -am 'Add feature'`
3. Push to branch: `git push origin feature/your-feature`
4. Submit pull request

## 📄 License

MIT License - See LICENSE file for details

## 🆘 Support

For issues, questions, or suggestions:
- Open GitHub issue
- Check documentation
- Review test files for usage examples

## 🎯 Roadmap

### Completed ✅
- [x] AI content generation with LLM
- [x] Content management system
- [x] Meta API integration
- [x] OAuth authentication
- [x] Multi-language support
- [x] Market analytics dashboard

### In Progress 🔄
- [ ] Content calendar with scheduling
- [ ] Analytics dashboard with engagement metrics
- [ ] Hashtag and caption optimizer
- [ ] Influencer collaboration tools

### Planned 📅
- [ ] Team collaboration features
- [ ] Content approval workflows
- [ ] Advanced analytics and reporting
- [ ] A/B testing framework
- [ ] Video content generation
- [ ] Automated posting schedules

## 📊 Project Statistics

- **Total Commits**: 4
- **Lines of Code**: ~5000+
- **Components**: 15+
- **API Procedures**: 20+
- **Test Cases**: 11
- **Supported Languages**: 6
- **Supported Platforms**: 3

---

**Last Updated**: February 13, 2026  
**Version**: 1.0.0  
**Status**: Active Development

For more information, visit [get-my-agent.com](https://get-my-agent.com)
