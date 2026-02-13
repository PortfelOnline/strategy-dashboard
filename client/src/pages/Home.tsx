import { useState } from 'react';
import { useAuth } from '@/_core/hooks/useAuth';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ChevronDown, TrendingUp, Users, Clock, Target } from 'lucide-react';

const platformData = [
  { name: 'YouTube', users: 462, reach: 61.5 },
  { name: 'Facebook', users: 367, reach: 48.8 },
  { name: 'Instagram', users: 363, reach: 25.3 },
  { name: 'WhatsApp', users: 400, reach: 83.0 },
];

const ageDistribution = [
  { age: '18-24', male: 24.4, female: 10.7 },
  { age: '25-34', male: 26.1, female: 10.6 },
  { age: '35-44', male: 12.0, female: 4.4 },
  { age: '45-54', male: 4.8, female: 2.0 },
];

const contentPillars = [
  {
    title: 'Relatable Desi Business Owner',
    hook: 'When a customer pings at 2:00 AM',
    format: 'Instagram Reel',
    description: 'Use trending Indian memes and humor to show the struggle of manual customer service. Split-screen: exhausted owner vs. AI responding instantly.',
  },
  {
    title: '5-Minute Transformation',
    hook: 'Setting up my AI employee in chai time',
    format: 'Fast-paced Reel',
    description: 'Demonstrate ease of setup with a visible timer. Shows the entire onboarding process in real-time, addressing complexity concerns.',
  },
  {
    title: 'ROI Calculator',
    hook: 'How I saved ₹50,000/month',
    format: 'Carousel Post / Video',
    description: 'Focus on financial benefits. Compare cost of human employee vs. ₹2,000/month AI agent. Shows clear "Paisa Vasool" (value for money).',
  },
];

export default function Home() {
  // The userAuth hooks provides authentication state
  // To implement login/logout functionality, simply call logout() or redirect to getLoginUrl()
  let { user, loading, error, isAuthenticated, logout } = useAuth();
  const [, navigate] = useLocation();

  const [expandedPillar, setExpandedPillar] = useState<number | null>(0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8F6F1] to-white">
      {/* Header */}
      <header className="bg-gradient-to-r from-[#1E3A8A] to-[#FF6B35] text-white py-8 px-4">
        <div className="container max-w-6xl mx-auto">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-3xl md:text-4xl font-bold">AI Consultant India Strategy</h1>
            {isAuthenticated && (
              <div className="flex gap-3 flex-wrap">
                <Button
                  onClick={() => navigate('/generator')}
                  className="bg-white text-blue-600 hover:bg-blue-50 font-semibold"
                >
                  Generate Content
                </Button>
                <Button
                  onClick={() => navigate('/library')}
                  className="bg-white text-blue-600 hover:bg-blue-50 font-semibold"
                >
                  My Library
                </Button>
                <Button
                  onClick={() => navigate('/accounts')}
                  className="bg-white text-blue-600 hover:bg-blue-50 font-semibold"
                >
                  Connected Accounts
                </Button>
              </div>
            )}
          </div>
          <p className="text-lg md:text-xl opacity-90">Viral Marketing Guide for get-my-agent.com</p>
        </div>
      </header>

      {/* Hero Banner */}
      <section className="py-8 px-4 bg-white border-b border-gray-200">
        <div className="container max-w-6xl mx-auto">
          <img src="/images/hero-banner.jpg" alt="Indian Social Media Ecosystem" className="w-full rounded-lg shadow-lg" />
        </div>
      </section>

      {/* Key Metrics */}
      <section className="py-12 px-4 bg-white">
        <div className="container max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold mb-8 text-[#1E3A8A]">Market Overview</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card className="border-l-4 border-l-[#FF6B35]">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                  <Users className="w-4 h-4" /> Total Users
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-[#1E3A8A]">491M</div>
                <p className="text-xs text-gray-500 mt-1">33.7% population penetration</p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-[#FF6B35]">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> Yearly Growth
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-[#FF6B35]">+6.3%</div>
                <p className="text-xs text-gray-500 mt-1">29M new users annually</p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-[#FF6B35]">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Daily Usage
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-[#1E3A8A]">2h 28m</div>
                <p className="text-xs text-gray-500 mt-1">Average time per user</p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-[#FF6B35]">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                  <Target className="w-4 h-4" /> Male Users
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-[#1E3A8A]">65.5%</div>
                <p className="text-xs text-gray-500 mt-1">Primary target demographic</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Demographics Infographic */}
      <section className="py-12 px-4 bg-[#F8F6F1]">
        <div className="container max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold mb-8 text-[#1E3A8A]">Demographics & Insights</h2>
          <img src="/images/demographics-infographic.jpg" alt="Demographics Infographic" className="w-full rounded-lg shadow-lg mb-8" />
          
          {/* Age Distribution Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Age Distribution by Gender</CardTitle>
              <CardDescription>Social media users in India by age group</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={ageDistribution}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="age" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="male" fill="#1E3A8A" name="Male %" />
                  <Bar dataKey="female" fill="#FF6B35" name="Female %" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Platform Comparison */}
      <section className="py-12 px-4 bg-white">
        <div className="container max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold mb-8 text-[#1E3A8A]">Platform Comparison</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card>
              <CardHeader>
                <CardTitle>Users by Platform (Millions)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={platformData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="users" fill="#1E3A8A" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Advertising Reach (%)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={platformData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="reach" fill="#FF6B35" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Content Pillars */}
      <section className="py-12 px-4 bg-[#F8F6F1]">
        <div className="container max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold mb-4 text-[#1E3A8A]">Viral Content Pillars</h2>
          <p className="text-gray-600 mb-8">Three proven strategies to create engaging content for the Indian market</p>
          
          <img src="/images/content-pillars.jpg" alt="Content Pillars" className="w-full rounded-lg shadow-lg mb-8" />

          <div className="space-y-4">
            {contentPillars.map((pillar, index) => (
              <Card key={index} className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setExpandedPillar(expandedPillar === index ? null : index)}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg text-[#1E3A8A]">{pillar.title}</CardTitle>
                      <CardDescription className="mt-2 text-[#FF6B35] font-semibold">"{pillar.hook}"</CardDescription>
                    </div>
                    <ChevronDown className={`w-5 h-5 transition-transform ${expandedPillar === index ? 'rotate-180' : ''}`} />
                  </div>
                </CardHeader>
                {expandedPillar === index && (
                  <CardContent className="pt-0">
                    <div className="space-y-3 text-sm">
                      <div>
                        <span className="font-semibold text-gray-700">Format:</span> {pillar.format}
                      </div>
                      <div>
                        <span className="font-semibold text-gray-700">Description:</span> {pillar.description}
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Key Insights */}
      <section className="py-12 px-4 bg-white">
        <div className="container max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold mb-8 text-[#1E3A8A]">Key Insights for Success</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Target Audience</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <p><strong>Primary:</strong> Male business owners aged 25-44</p>
                <p><strong>Secondary:</strong> E-commerce sellers, real estate agents, service providers</p>
                <p><strong>Pain Points:</strong> Lost leads, 24/7 availability, manual processes</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Language Strategy</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <p><strong>Hinglish:</strong> Use Hindi-English mix for authenticity</p>
                <p><strong>Regional:</strong> Consider Tamil, Telugu, Bengali for targeted ads</p>
                <p><strong>Key Phrase:</strong> "Paisa Vasool" (value for money)</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Platform Priorities</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <p><strong>Instagram:</strong> Reels, visual storytelling, influencer partnerships</p>
                <p><strong>Facebook:</strong> Community groups, older business owners, lead ads</p>
                <p><strong>WhatsApp:</strong> Business communication, customer support</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pricing Messaging</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <p><strong>Always use ₹:</strong> ₹2,000/month feels more affordable than $24/month</p>
                <p><strong>Compare to hiring:</strong> Full-time employee costs ₹15,000-30,000/month</p>
                <p><strong>Highlight savings:</strong> ₹48,000+ monthly savings</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-12 px-4 bg-gradient-to-r from-[#1E3A8A] to-[#FF6B35] text-white">
        <div className="container max-w-6xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to Launch Your Campaign?</h2>
          <p className="text-lg mb-8 opacity-90">Download the complete strategy document for detailed implementation roadmap and content calendar</p>
          <Button className="bg-white text-[#FF6B35] hover:bg-gray-100 font-semibold px-8 py-6 text-lg">
            Download Full Strategy
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-8 px-4">
        <div className="container max-w-6xl mx-auto text-center text-sm text-gray-400">
          <p>Strategy Dashboard for get-my-agent.com | Indian Social Media Marketing 2026</p>
        </div>
      </footer>
    </div>
  );
}
