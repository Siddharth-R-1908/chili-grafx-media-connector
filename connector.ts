import { type Connector, type Media } from "@chili-publish/studio-connectors";

export default class MyConnector implements Media.MediaConnector {
  private runtime: Connector.ConnectorRuntimeContext;

  private log(...messages: string[]) {
    if (!this.runtime.options["logEnabled"]) return;
    this.runtime.logError(messages.join(" "));
  }

  // private getFullUrl(url: string): string {
  //   if (this.runtime.options["baseUrl"]) {
  //     return this.runtime.options["baseUrl"] + url;
  //   }
  //   return url;
  // }

  // private getFullUrl(imageId: string): string {
  //   const template =
  //     "https://ashleyfurniture.scene7.com/is/image/AshleyFurniture/%data%?wid=240&hei=168&fit=fit,1&fmt=jpeg";

  //   return template.replace("%data%", imageId);
  // }

  private getFullUrl(imageId: string, imageType?: string): string {
    const normalizedId = imageId.trim().replace(/\s+/g, "");
    const highResTemplate2 =
      "https://ashleyfurniture.scene7.com/is/image/AshleyFurniture/%data%?wid=240&hei=168&fit=fit,1&fmt=jpeg";

    const highResTemplate1 =
      "https://ashleyfurniture.scene7.com/is/image/AshleyFurniture/%data%?wid=1276&hei=1020&fit=fit,1&fmt=jpeg";

    const enterpriseTemplate =
      "https://res.cloudinary.com/ashleyhub/image/upload/co_rgb:ffffff,e_colorize:100/v1657307093/MattressLogos/%data%.png"
    // const template = imageType === "highres1" ? highResTemplate1 : highResTemplate2;
    if (imageType === "highres1") {
      const template = highResTemplate1
      return template.replace("%data%", imageId);
    } else if (imageType === "enterprise2") {
      const template = enterpriseTemplate
      return template.replace("%data%", normalizedId);
    } else {
      const template = highResTemplate2
      return template.replace("%data%", imageId);
    }

  }


  constructor(runtime: Connector.ConnectorRuntimeContext) {
    this.runtime = runtime;
  }

  async query(
    options: Connector.QueryOptions,
    context: Connector.Dictionary,
  ): Promise<Media.MediaPage> {
    const imageId = context["imageId"] as string;
    this.log(
      "QUERY",
      JSON.stringify(options, null, 4),
      JSON.stringify(context, null, 4),
    );

    return {
      pageSize: options.pageSize ?? 1, // Note: pageSize is not currently used by the UI

      data: [
        {
          id: imageId,
          name: imageId,
          relativePath: "",
          type: 0,
          metaData: {},
        },
      ],

      links: {
        nextPage: "", // Pagination is ignored in this example
      },
    };
  }

  async detail(
    id: string,
    context: Connector.Dictionary,
  ): Promise<Media.MediaDetail> {
    return {
      name: id,
      id: id,
      metaData: {},
      relativePath: "/",
      type: 0,
    };
  }

  async download(
    id: string,
    previewType: Media.DownloadType,
    intent: Media.DownloadIntent,
    context: Connector.Dictionary,
  ): Promise<Connector.ArrayBufferPointer> {
    this.log(
      "DOWNLOAD",
      JSON.stringify(context, null, 4),
      JSON.stringify(previewType, null, 4),
      JSON.stringify(intent, null, 4),
    );

    const url = this.getFullUrl(
      context["imageId"] as string,
      context["imageType"] as string
    );

    const picture = await this.runtime.fetch(url, {
      method: "GET",
    });

    return picture.arrayBuffer;
  }

  getConfigurationOptions(): Connector.ConnectorConfigValue[] | null {
    return [
      {
        name: "imageId",
        displayName: "Image Id",
        type: "text",
      },
      {
        name: "imageType",
        displayName: "Image Type",
        type: "text", 
      },
    ];
  }

  getCapabilities(): Media.MediaConnectorCapabilities {
    return {
      query: true,
      detail: true,
      filtering: true,
      metadata: false,
    };
  }
}



















// import { Connector, Media } from "@chili-publish/studio-connectors";

// export default class MyConnector implements Media.MediaConnector {

//   private runtime: Connector.ConnectorRuntimeContext;

//   constructor(runtime: Connector.ConnectorRuntimeContext) {
//     this.runtime = runtime;
//   }

//   async query(
//     options: Connector.QueryOptions,
//     context: Connector.Dictionary
//   ): Promise<Media.MediaPage> {
//     // We set pageNumber according to pageToken param if it's valid or use default value
//     const pageNumber = Number(options.pageToken) || 1;
//     const resp = await this.runtime.fetch(
//       `https://picsum.photos/v2/list?page=${pageNumber}&limit=${options.pageSize}`,
//       {
//         method: 'GET',
//       }
//     );

//     //https://ashleyfurniture.scene7.com/is/image/AshleyFurniture/%data%?wid=120&hei=84&fit=fit,1&fmt=jpeg
//     // Handle error case
//     if (!resp.ok) {
//       throw new ConnectorHttpError(
//         resp.status,
//         `[Acheron connector]: Failed to fetch images from picsum.photos: ${resp.status}-${resp.statusText}`
//       );
//     }

//     const data = JSON.parse(resp.text);
//     let imageUrl = "https://ashleyfurniture.scene7.com/is/image/AshleyFurniture/%data%?wid=120&hei=84&fit=fit,1&fmt=jpeg";
//     let temp_imageUrl:any = imageUrl.replace("%data%", context["value"] as string);

//     const t_dataFormatted = [{
//       id: temp_imageUrl,
//       name: temp_imageUrl,
//       relativePath: '/', 
//       extension: 'png', 
//       type: 0 as any, 
//       metaData: {}
//     }]


//     return {
//       pageSize: options.pageSize, 
//       data: t_dataFormatted,
//       links: {
//         nextPage:
//           t_dataFormatted.length === options.pageSize ? `${pageNumber + 1}` : '', 
//       },
//     };
//   }

//   detail(
//     id: string,
//     context: Connector.Dictionary
//   ): Promise<Media.MediaDetail> {
//     throw new Error("Method not implemented.");
//   }

//   async download(
//     id: string,
//     previewType: Media.DownloadType,
//     intent: Media.DownloadIntent,
//     context: Connector.Dictionary
//   ): Promise<Connector.ArrayBufferPointer> {
//     switch (previewType) {
//       case "thumbnail": {
//         // const picture = await this.runtime.fetch(`https://picsum.photos/id/${id}/200`, { method: "GET" });
//         const picture = await this.runtime.fetch(id, { method: "GET" });
//         return picture.arrayBuffer;
//       }
//       case "mediumres": {
//         const picture = await this.runtime.fetch(id, { method: "GET" });
//         return picture.arrayBuffer;
//       }
//       case "highres": {
//         const picture = await this.runtime.fetch(id, { method: "GET" });
//         return picture.arrayBuffer;
//       }
//       default: {
//         const picture = await this.runtime.fetch(id, { method: "GET" });
//         return picture.arrayBuffer;
//       }
//     }
//   }

//   getConfigurationOptions(): Connector.ConnectorConfigValue[] | null {
//     return [
//       {
//         name: "baseURL",
//         displayName: "BASE URL",
//         type: "text"
//       },
//       {
//         name: "value",
//         displayName: "VALUE",
//         type: "text"
//       }
//     ];
//   }

//   getCapabilities(): Media.MediaConnectorCapabilities {
//     return {
//       query: true,
//       detail: true,
//       filtering: false,
//       metadata: false,
//     };
//   }
// }