// Policy pages, copied word for word from the owner's previous store
// (kitaabaurkona.com/about-us, /return-policy, /shipping-policy, /privacy-policy), with
// the owner's corrections: shipping is free, "books" not "ebooks", return notes for books.
// Each page is a list of blocks: { h: heading } | { p: paragraph } | { ul: [items] }.

export const POLICIES = {
  about: {
    title: 'About kitaabaurkona',
    blocks: [
      {
        p: "kitaabaurkona is your ultimate destination for books across every genre and interest imaginable. From timeless classics and contemporary fiction to self-help, spirituality, comics, and children's literature, we curate an extensive collection of books that cater to every reader's passion. Whether you're seeking thrilling mysteries, epic fantasies, insightful biographies, or practical guides on business and wellness, we bring the world of literature right to your fingertips.",
      },
      {
        p: 'We serve curious minds, lifelong learners, and passionate readers from all walks of life. Our collection is thoughtfully designed for students expanding their knowledge, professionals seeking growth, parents nurturing young imaginations, and anyone who believes in the transformative power of a good book. From the casual reader to the devoted bibliophile, kitaabaurkona welcomes everyone into our vibrant community of book lovers.',
      },
      {
        p: "At kitaabaurkona, we believe that books are more than just pages—they are gateways to new worlds, catalysts for personal growth, and companions on life's journey. We are committed to making quality literature accessible, affordable, and available to readers across India, because we know that every book has the power to inspire, educate, and transform. Our mission is to connect you with stories and knowledge that enrich your life and expand your horizons.",
      },
      { strong: 'kitaabaurkona — Where Every Page Turns Into Possibility.' },
    ],
  },
  returns: {
    title: 'Return policy',
    blocks: [
      { h: 'Cancellation Policy:' },
      {
        ul: [
          'In case there is an order cancellation, please do so before it is shipped. Once the product is shipped it can not be cancelled using our website',
        ],
      },
      { h: 'Return Policy:' },
      {
        ul: [
          'Returns and exchanges are applicable only to select products. Detailed return eligibility and conditions are provided on the respective product pages. For most products, the standard return window is 3 days.',
          'The return policy for any product is subject to change without prior notice.',
          'In case we do not have pick up service available at your location, you would have to self-ship the product to our office Address.',
          'Return/Exchange charges may apply on case to case basis.',
        ],
      },
      { h: 'NOTE FOR RETURN' },
      {
        ul: [
          'Books should be unused, unmarked and in the same condition you received them.',
          'Books should be returned in their original packaging, with any shrink wrap, box or slipcase that came with them.',
          'Damaged or wrong books must be reported with photos within the return period.',
          'Return/Exchange requests that are not raised within the return period (Refer product page) the product would not be accepted.',
        ],
      },
    ],
  },
  shipping: {
    title: 'Shipping policy',
    blocks: [
      {
        p: "We ship all over India and try to get the best rates for our customers. Orders placed Monday through Saturday IST will be processed on the same or following business day and will be shipped within two business days of order placement if the product(s) is(are) in inventory in our warehouse. If you want to inquire about the delivery time of a product, do not hesitate to contact us prior to placing your order. Shipping is free on all orders. If you have any further questions, please don't hesitate to contact us at Kitaabaurkona@gmail.com",
      },
    ],
  },
  privacy: {
    title: 'Privacy policy',
    blocks: [
      {
        p: 'Your personal information is always kept confidential. The privacy policy is displayed on the website. The type of info collected from the customers and usage of this information is published here. We have a policy of not disclosing any information to third parties. Using our website means you have agreed to the terms and conditions of the website. It applies to the people who have not got any transactions or who have got registered to the site and had business. Personal information is mainly used to locate or contact a person. Other information like name address, phone number, fax, credit card information, financial profiles, identification number and e-mail address are also available with us and are always confidential.',
      },
      { h: 'Terms Of Our Privacy Policy' },
      { h: 'Personal Information That We collect' },
      {
        p: 'Necessary information is collected for becoming a subscriber or member of our website. Our system collects the IP address of your computer automatically. But this detail does not give information about any particular person. But KITAABAURKONA website doesn’t collect information about children.',
      },
      { h: 'Uses Of The Information Collected' },
      { p: 'All the personal information collected is kept confidential. The information may be used for:' },
      {
        ul: [
          'Send news about the website.',
          'Calculate the number of visitors',
          'Monitor the website',
          'Know the geographical location of the users',
          'Contact to give information bout the website.',
          'Give a better shopping experience online.',
          'Update about the recent offers on the website.',
        ],
      },
      {
        p: 'Some of the personal information is shared with the courier companies like addresses/contact details. We have to give some information to vendors. This personal information helps KITAABAURKONA to perform their duties and fulfil the order requirements. But private information cannot be accessed by unauthorised persons or organisations. The Company will disclose your information, including, without limitation, your name,city, state, telephone number, email address, user ID history, quoting and listing history, and complaints, to law enforcement or other government officials if it is required to do so by law, regulation or other government authority or otherwise in cooperation with an investigation of governmental authority. Cookies are used to save your personal information on your computer. It helps to calculate the number of times you use our website. Cookies do not keep any personal data of the visitors. When the user browses , cookies are replaced according to the interests of the users. Here none of your particulars like e-mail address, telephone, name or postal address is collected. We give you a safe shopping experience. KITAABAURKONA gives some aggregate particulars like website statics or demographics to sponsors, advertisers and other third parties. Third parties are not authorised to get any of your personal information. KITAABAURKONA has many links to other websites. But once you leave KITAABAURKONA website, our privacy policy ends.',
      },
    ],
  },
};

export const POLICY_LINKS = [
  { to: '/about', label: 'About Us' },
  { to: '/returns', label: 'Return Policy' },
  { to: '/terms', label: 'Terms & Conditions' },
  { to: '/privacy', label: 'Privacy Policy' },
  { to: '/shipping', label: 'Shipping Policy' },
];
